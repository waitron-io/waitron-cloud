import {organisationScopeSql, resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import type {Context} from 'hono';
import type {Pool} from 'pg';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
import {readAccountBody} from './request.ts';

const listPath = '/api/account/sent-reports/list';
const readPath = '/api/account/sent-reports/read';
const pageSize = 50;
const uuid = (value: unknown): value is string =>
 typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const invalidInput = () => new AccountHttpError(400, 'invalid_input');
const denied = () => new AccountHttpError(403, 'permission_denied');

function decodeCursor(value: string|undefined, venueId: string): [string, string]|null {
 if (value === undefined) return null;
 if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw invalidInput();
 const bytes = Buffer.from(value, 'base64url');
 if (bytes.toString('base64url') !== value) throw invalidInput();
 let parts: unknown;
 try { parts = JSON.parse(bytes.toString('utf8')); } catch { throw invalidInput(); }
 if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== venueId || !uuid(parts[1]) || !uuid(parts[2])) throw invalidInput();
 return [parts[1], parts[2]];
}

const visible = `FROM installation_error_reports r JOIN installations i ON i.id=r.installation_id
 WHERE i.venue_id=$1 AND r.kind='staff' AND r.staff_receipt_owner_id=$2
 AND r.reported_at >= $3::timestamptz AND r.staff_report_body IS NOT NULL`;

interface SummaryRow {
 installation_id: string;
 operation_id: string;
 reported_at: Date;
 version_major: number;
 version_minor: number;
 version_patch: number;
}

export async function sentReportsResponse(c: Context, {pool, origin, consume}: {
 pool: Pool; origin: string; consume: (rules: RateRule[]) => Promise<void>;
}): Promise<Response> {
 const list = c.req.path === listPath;
 if (!list && c.req.path !== readPath) throw new AccountHttpError(404, 'not_found');
 if (c.req.method !== 'POST') throw new AccountHttpError(405, 'method_not_allowed');
 if (c.req.header('origin') !== origin) throw new AccountHttpError(403, 'forbidden');
 const body = await readAccountBody(c.req.raw, list ? ['venueId'] : ['venueId', 'installationId', 'reportId'], list ? ['cursor'] : []);
 const {venueId, installationId, reportId} = body;
 if (!uuid(venueId) || (!list && (!uuid(installationId) || !uuid(reportId)))) throw invalidInput();
 const after = decodeCursor(body.cursor, venueId);
 const token = readSessionCookie(c, new URL(origin).protocol === 'https:') ?? '';
 const proof = {csrfToken: c.req.header('x-csrf-token') ?? '', touch: false as const};
 const identity = await transaction(pool, client => resolveSession(client, token, proof));
 await consume([{scope: 'sent-reports-account', subject: identity.accountId, limit: 30, windowSeconds: 60}]);

 return c.json(await transaction(pool, async client => {
  const {accountId} = await resolveSession(client, token, proof);
  // Keep the membership through the read and compare the cutoff at database precision.
  const membership = (await client.query<{owner_since: string}>(`
   SELECT m.owner_since::text FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id
   WHERE v.id=$1 AND m.account_id=$2 AND m.is_owner AND m.owner_since IS NOT NULL
    AND ${organisationScopeSql('m.account_id', 'm.organisation_id')}
   FOR SHARE OF m`, [venueId, accountId])).rows[0];
  if (!membership) throw denied();
  const scope = [venueId, accountId, membership.owner_since];
  if (!list) {
   const row = (await client.query<{report_body: string; description_body: string|null}>(`
    SELECT r.staff_report_body AS report_body,
     CASE WHEN r.staff_description_at >= $3::timestamptz THEN r.staff_description_body END AS description_body
    ${visible} AND r.installation_id=$4 AND r.operation_id=$5`, [...scope, installationId, reportId])).rows[0];
   if (!row) throw denied();
   await resolveSession(client, token, proof);
   return {venueId, installationId, reportId, reportBody: row.report_body, descriptionBody: row.description_body};
  }

  let cursorTime: string|null = null;
  if (after) {
   const anchor = (await client.query<{received_at: string}>(`SELECT r.received_at::text
    ${visible} AND r.installation_id=$4 AND r.operation_id=$5`, [...scope, ...after])).rows[0];
   if (!anchor) throw invalidInput();
   cursorTime = anchor.received_at;
  }
  const {rows} = await client.query<SummaryRow>(`
   SELECT r.installation_id,r.operation_id,r.reported_at,r.version_major,r.version_minor,r.version_patch
   ${visible} AND ($4::timestamptz IS NULL OR (r.received_at,r.installation_id,r.operation_id)<($4::timestamptz,$5::uuid,$6::uuid))
   ORDER BY r.received_at DESC,r.installation_id DESC,r.operation_id DESC LIMIT $7`, [...scope, cursorTime, after?.[0], after?.[1], pageSize + 1]);
  const reports = rows.slice(0, pageSize).map(row => ({
   installationId: row.installation_id,
   reportId: row.operation_id,
   reportedAt: row.reported_at.toISOString(),
   version: `${row.version_major}.${row.version_minor}.${row.version_patch}`,
  }));
  const last = reports.at(-1);
  const nextCursor = rows.length > pageSize && last
   ? Buffer.from(JSON.stringify([venueId, last.installationId, last.reportId])).toString('base64url')
   : null;
  await resolveSession(client, token, proof);
  return {venueId, reports, nextCursor};
 }));
}
