import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';

export const accountRecoveryCodeHash=(accountId:string,code:string)=>createHash('sha256')
  .update(JSON.stringify(['cloud-account-recovery-v1',accountId,code])).digest('hex');

export async function createAccountRecoveryCodes(client:PoolClient,accountId:string):Promise<string[]> {
 const codes=Array.from({length:10},()=>randomBytes(16).toString('hex').toUpperCase()),generation=randomUUID();
 await client.query('UPDATE cloud_factor_recovery_codes SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[accountId]);
 // A null factor version selects account-bound hashes; legacy rows keep their original hash inputs.
 for(const code of codes)await client.query(`INSERT INTO cloud_factor_recovery_codes(account_id,secret_generation,factor_version,code_hash)
  VALUES($1,$2,NULL,$3)`,[accountId,generation,accountRecoveryCodeHash(accountId,code)]);
 return codes;
}

export function recoveryCodeHash(accountId:string,version:number,code:string):string {
 return createHash('sha256').update(JSON.stringify(['cloud-factor-recovery-v1',accountId,version,code])).digest('hex');
}

/** Caller holds the account lock; a refused action must roll back this consumption. */
export async function consumeAccountRecoveryCode(client:PoolClient,accountId:string,code:string,deadline:Date):Promise<boolean> {
 if(typeof code!=='string'||!/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{8}){3})$/.test(code))return false;
 const enrolled=await client.query(`SELECT 1 FROM cloud_passkeys WHERE account_id=$1
  UNION ALL SELECT 1 FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL LIMIT 1`,[accountId]);
 if(!enrolled.rowCount)return false;
 const normalised=code.replaceAll('-','').toUpperCase();
 const rows=await client.query('SELECT * FROM cloud_factor_recovery_codes WHERE account_id=$1 AND consumed_at IS NULL FOR UPDATE',[accountId]);
 const row=rows.rows.find(row=>row.code_hash===(row.factor_version===null?accountRecoveryCodeHash(accountId,normalised)
  :recoveryCodeHash(accountId,row.factor_version,normalised)));
 const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
 if(!row||now>=deadline)return false;
 await client.query(`UPDATE cloud_factor_recovery_codes SET consumed_at=$4
  WHERE account_id=$1 AND secret_generation=$2 AND code_hash=$3`,[accountId,row.secret_generation,row.code_hash,now]);
 return true;
}

/** The account lock serializes removal with enrollment and code consumption. */
export async function retireRecoveryCodesWithoutMethod(client:PoolClient,accountId:string):Promise<void> {
 await client.query(`UPDATE cloud_factor_recovery_codes SET consumed_at=clock_timestamp()
  WHERE account_id=$1 AND consumed_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM cloud_passkeys WHERE account_id=$1)
   AND NOT EXISTS(SELECT 1 FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL)`,[accountId]);
}
