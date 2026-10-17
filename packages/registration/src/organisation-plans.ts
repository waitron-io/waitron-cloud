import type {Pool, PoolClient} from 'pg';
import {transaction} from './transaction.ts';

export type OrganisationPlan = 'free' | 'paid';
export type PlanService = 'address_lookup' | 'transactional_email' | 'content_translation'
  | 'continuous_backup' | 'retained_snapshots' | 'remote_access';
export type PlanMode = 'existing' | 'test-free-paid';
export interface OrganisationPlanView {
  organisationId: string;
  plan: OrganisationPlan;
  revision: number;
  changed: boolean;
}

function requireMode(mode: PlanMode): void {
  if (mode !== 'existing' && mode !== 'test-free-paid') throw new Error('invalid_plan_mode');
}
function requireId(id: string): void {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('invalid_organisation');
}
export function parsePlanMode(value: string | undefined): PlanMode {
  if (value === undefined || value === '0') return 'existing';
  if (value === '1') return 'test-free-paid';
  throw new Error('invalid_plan_mode');
}

// Callers supply the stored venue environment after authenticating its binding.
export function requireTestPlanVenue(environment: string, mode: PlanMode): void {
  requireMode(mode);
  if (mode === 'test-free-paid' && environment !== 'test') throw new Error('permission_denied');
}
export function planAllows(plan: OrganisationPlan, service: PlanService): boolean {
  if (plan !== 'free' && plan !== 'paid') return false;
  if (['address_lookup', 'transactional_email', 'content_translation'].includes(service)) return true;
  return plan === 'paid' && ['continuous_backup', 'retained_snapshots', 'remote_access'].includes(service);
}

interface PlanRow {id: string; service_plan: OrganisationPlan; service_plan_revision: number}
async function readRow(client: PoolClient, organisationId: string, lock: 'SHARE' | 'UPDATE'): Promise<PlanRow> {
  requireId(organisationId);
  const row = (await client.query<PlanRow>(`SELECT id,service_plan,service_plan_revision FROM organisations WHERE id=$1 FOR ${lock}`, [organisationId])).rows[0];
  if (!row) throw new Error('organisation_not_found');
  return row;
}
function view(row: PlanRow, changed = false): OrganisationPlanView {
  return {organisationId: row.id, plan: row.service_plan, revision: row.service_plan_revision, changed};
}

// Use inside a transaction: policy precedes installation/service locks, and the
// shared row lock keeps an admitted operation ahead of a competing plan change.
export async function readOrganisationPlan(client: PoolClient, organisationId: string): Promise<OrganisationPlan> {
  return (await readRow(client, organisationId, 'SHARE')).service_plan;
}
export async function requirePlanService(client: PoolClient, organisationId: string, service: PlanService, mode: PlanMode): Promise<void> {
  requireMode(mode);
  if (mode === 'existing') return;
  if (!planAllows(await readOrganisationPlan(client, organisationId), service)) throw new Error('permission_denied');
}

export class OrganisationPlanStore {
  private readonly pool: Pool;
  constructor(pool: Pool) {this.pool = pool;}
  async show(organisationId: string): Promise<OrganisationPlanView> {
    return transaction(this.pool, async client => view(await readRow(client, organisationId, 'SHARE')));
  }
  async set(organisationId: string, plan: OrganisationPlan): Promise<OrganisationPlanView> {
    if (plan !== 'free' && plan !== 'paid') throw new Error('invalid_service_plan');
    return transaction(this.pool, async client => {
      const row = await readRow(client, organisationId, 'UPDATE');
      if (row.service_plan === plan) return view(row);
      const updated = (await client.query<PlanRow>(`UPDATE organisations SET service_plan=$2,service_plan_revision=service_plan_revision+1
        WHERE id=$1 RETURNING id,service_plan,service_plan_revision`, [organisationId, plan])).rows[0]!;
      return view(updated, true);
    });
  }
}
