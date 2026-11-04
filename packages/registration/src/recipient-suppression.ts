import type {PoolClient} from 'pg';
import type {MailScope} from './ses-feedback-config.ts';
export interface RecipientRef {keyId:string;digest:string}

/** Include the schema so disposable databases and separate deployments do not share locks. */
export async function lockMailScope(client:PoolClient,scope:MailScope):Promise<void> {
 try{await client.query('SAVEPOINT mail_scope_transaction');}
 catch(error){if((error as {code?:string}).code==='25P01')throw Error('mail_transaction_required');throw error;}
 await client.query('RELEASE SAVEPOINT mail_scope_transaction');
 if(!scope||!/^[A-Z]{2}$/.test(scope.country)||!/^\d{12}$/.test(scope.providerAccountId)
  ||!['eu-north-1','eu-west-3'].includes(scope.region))throw Error('mail_scope_unavailable');
 // One scope lock covers both purposes and every retained key, including during rotation.
 await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))",
  [JSON.stringify(['waitron-mail-scope-v1',scope.country,scope.providerAccountId,scope.region])]);
}

export async function recipientIsSuppressed(client:PoolClient,scope:MailScope,refs:readonly RecipientRef[]):Promise<boolean> {
 await lockMailScope(client,scope);
 if(!Array.isArray(refs)||refs.length===0||refs.some(ref=>!ref||!/^[A-Za-z0-9_-]{1,64}$/.test(ref.keyId)||!/^[a-f0-9]{64}$/.test(ref.digest)))throw Error('mail_keys_unavailable');
 const found=await client.query(`SELECT 1 FROM mail_suppressions s JOIN unnest($4::text[],$5::text[]) AS r(key_id,digest)
  ON s.key_id=r.key_id AND s.digest=r.digest WHERE s.country=$1 AND s.provider_account_id=$2 AND s.region=$3 LIMIT 1`,
  [scope.country,scope.providerAccountId,scope.region,refs.map(r=>r.keyId),refs.map(r=>r.digest)]);
 return found.rowCount!==0;
}
