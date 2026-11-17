import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
// Authority-reader tests start with an enrolled recovered account; enrollment verification belongs to identity.
export async function setRecoveryScope(pool:Pool,accountId:string,organisationId:string= randomUUID()):Promise<string>{
 await pool.query('INSERT INTO organisations(id) VALUES($1) ON CONFLICT DO NOTHING',[organisationId]);
 await pool.query("INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,'fixture-enrolled') ON CONFLICT(account_id) DO NOTHING",[accountId,randomUUID()]);
 await pool.query('UPDATE cloud_accounts SET recovery_organisation_id=$2 WHERE id=$1',[accountId,organisationId]);
 return organisationId;
}
