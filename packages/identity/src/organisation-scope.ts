import type {PoolClient} from 'pg';
import {IdentityError} from './sessions.ts';

// Expressions come only from trusted query text; memberships remain the ownership authority.
export function organisationScopeSql(account:string,organisation:string):string {
  return `(SELECT COALESCE(to_jsonb(recovery_account)->>'recovery_organisation_id'=${organisation}::text,true) FROM cloud_accounts recovery_account WHERE recovery_account.id=${account})`;
}
export async function requireOrganisationScope(client:PoolClient,accountId:string,organisationId:string):Promise<void> {
  const account=(await client.query("SELECT to_jsonb(a)->>'recovery_organisation_id' AS restriction FROM cloud_accounts a WHERE id=$1 AND disabled_at IS NULL FOR SHARE",[accountId])).rows[0];
  if(!account || account.restriction && account.restriction!==organisationId)throw new IdentityError('permission_denied');
  if(account.restriction){
    const enrolled=await client.query('SELECT 1 FROM cloud_passkeys WHERE account_id=$1 UNION ALL SELECT 1 FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL LIMIT 1',[accountId]);
    if(!enrolled.rowCount)throw new IdentityError('enrollment_required');
  }
}
