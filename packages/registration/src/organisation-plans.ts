import type {Pool, PoolClient} from 'pg';
import {transaction} from './transaction.ts';

export type OrganisationPlan = 'free' | 'paid';
export type PlanService = 'address_lookup' | 'transactional_email' | 'content_translation'
  | 'continuous_backup' | 'retained_snapshots' | 'remote_access';
export type PlanMode = 'existing' | 'test-free-paid' | 'test-venue-levels';
export interface OrganisationPlanView {
  organisationId: string;
  plan: OrganisationPlan;
  revision: number;
  changed: boolean;
}

function requireMode(mode: PlanMode): void {
  if (mode !== 'existing' && mode !== 'test-free-paid' && mode !== 'test-venue-levels') throw new Error('invalid_plan_mode');
}
function requireId(id: string): void {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('invalid_organisation');
}
export function parsePlanMode(value: string | undefined, venueLevels?: string): PlanMode {
  if (venueLevels !== undefined && venueLevels !== '0') {
    if (venueLevels !== 'test' || (value !== undefined && value !== '0')) throw new Error('invalid_plan_mode');
    return 'test-venue-levels';
  }
  if (value === undefined || value === '0') return 'existing';
  if (value === '1') return 'test-free-paid';
  throw new Error('invalid_plan_mode');
}

// Callers supply the stored venue environment after authenticating its binding.
export function requireTestPlanVenue(environment: string, mode: PlanMode): void {
  requireMode(mode);
  if (mode === 'test-venue-levels' && environment !== 'test') throw new Error('permission_denied');
  if (mode === 'test-free-paid' && environment !== 'test') throw new Error('permission_denied', {cause: 'test_venue_required'});
}
export function planAllows(plan: OrganisationPlan, service: PlanService): boolean {
  if (plan !== 'free' && plan !== 'paid') return false;
  if (['address_lookup', 'transactional_email', 'content_translation'].includes(service)) return true;
  return plan === 'paid' && ['continuous_backup', 'retained_snapshots', 'remote_access'].includes(service);
}

interface PlanRow {id: string; service_plan: OrganisationPlan; service_plan_revision: number}
async function readRow(client: PoolClient, organisationId: string, lock: 'SHARE' | 'NO KEY UPDATE'): Promise<PlanRow> {
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
  if (mode === 'test-venue-levels') throw new Error('invalid_plan_mode');
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
      const row = await readRow(client, organisationId, 'NO KEY UPDATE');
      if (row.service_plan === plan) return view(row);
      const updated = (await client.query<PlanRow>(`UPDATE organisations SET service_plan=$2,service_plan_revision=service_plan_revision+1
        WHERE id=$1 RETURNING id,service_plan,service_plan_revision`, [organisationId, plan])).rows[0]!;
      await advancePlanConfiguration(client, organisationId, plan === 'free');
      return view(updated, true);
    });
  }
}

// Policy precedes installation and service locks. NO KEY UPDATE in the setter
// fences these SHARE readers without blocking foreign-key KEY SHARE readers.
export async function readVenuePlan(client: PoolClient, venueId: string, mode: PlanMode): Promise<OrganisationPlan> {
  requireMode(mode);
  if (mode === 'test-venue-levels') throw new Error('invalid_plan_mode');
  if (mode === 'existing') return 'paid';
  const row = (await client.query('SELECT organisation_id,environment FROM venues WHERE id=$1', [venueId])).rows[0];
  if (!row) throw new Error('permission_denied');
  requireTestPlanVenue(row.environment, mode);
  const plan = await readOrganisationPlan(client, row.organisation_id);
  const locked = (await client.query('SELECT organisation_id,environment FROM venues WHERE id=$1 FOR SHARE', [venueId])).rows[0];
  if (!locked || locked.organisation_id !== row.organisation_id) throw new Error('permission_denied');
  requireTestPlanVenue(locked.environment, mode);
  if ((await client.query('SELECT 1 FROM billing_service_authority WHERE venue_id=$1', [venueId])).rowCount) throw new Error('permission_denied');
  return plan;
}

export async function advancePlanConfiguration(client: PoolClient, organisationId: string, downgrade: boolean): Promise<void> {
  const rows = (await client.query(`SELECT i.id FROM installations i JOIN venues v ON v.id=i.venue_id
    WHERE v.organisation_id=$1 AND NOT EXISTS (SELECT 1 FROM billing_service_authority a WHERE (a.organisation_id,a.legal_business_id,a.venue_id)=(v.organisation_id,v.legal_business_id,v.id)) ORDER BY i.id FOR UPDATE OF i`, [organisationId])).rows;
  for (const row of rows) {
    await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1', [row.id]);
    if (downgrade) await client.query(`UPDATE installation_services SET state='unconfigured',configuration='{}'
      WHERE installation_id=$1 AND service IN ('continuous_backup','retained_snapshots','remote_access')`, [row.id]);
  }
}
