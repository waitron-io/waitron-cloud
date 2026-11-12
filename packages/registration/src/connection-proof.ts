import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {IdentityError,resolveSession} from '@waitron-cloud/identity';
import {AccountActionProofError,requireAccountActionProof} from './account-action-proof.ts';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
async function enrolled(client:PoolClient,accountId:string){
 const row=(await client.query(`SELECT EXISTS(SELECT 1 FROM cloud_passkeys WHERE account_id=$1)
  OR EXISTS(SELECT 1 FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL) AS enrolled`,[accountId])).rows[0];
 if(!row.enrolled)throw new IdentityError('enrollment_required');
}
export async function requireConnectionProof(client:PoolClient,token:string,csrfToken:string){
 // Take the account before the session and request so security changes use the same lock order.
 await client.query('SELECT a.id FROM cloud_accounts a JOIN cloud_sessions s ON s.account_id=a.id WHERE s.token_hash=$1 FOR UPDATE OF a',[digest(token)]);
 const session=await resolveSession(client,token,{csrfToken,touch:false});
 await enrolled(client,session.accountId);
 const proof=await requireAccountActionProof(client,token,csrfToken);
 const row=(await client.query('SELECT id FROM cloud_sessions WHERE token_hash=$1',[digest(token)])).rows[0];
 return {...proof,sessionId:row.id as string};
}
export async function requirePendingConnectionProof(client:PoolClient,accountId:string,sessionId:string|null,revision:number|null){
 const account=await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[accountId]);
 if(!account.rowCount)throw new IdentityError('session_unavailable');
 if(!sessionId||revision===null)throw new AccountActionProofError();
 const row=(await client.query(`SELECT s.action_security_revision,s.action_credential_fingerprint,s.absolute_expires_at,c.password_hash
  FROM cloud_sessions s JOIN cloud_credentials c ON c.account_id=s.account_id
  WHERE s.id=$1 AND s.account_id=$2 AND s.ended_at IS NULL FOR UPDATE OF s FOR SHARE OF c`,[sessionId,accountId])).rows[0];
 if(!row)throw new IdentityError('session_unavailable');
 if(row.absolute_expires_at<=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now)throw new IdentityError('session_expired');
 // Accepted work retains authority, not the browser's idle deadline or ten-minute prompt window.
 if(row.action_security_revision!==revision||!row.password_hash||row.action_credential_fingerprint!==digest(row.password_hash))throw new AccountActionProofError();
 await enrolled(client,accountId);
}
