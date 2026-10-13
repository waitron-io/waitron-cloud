import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {decryptFactorSecret,encryptFactorSecret,type FactorBinding,type FactorKeys} from '@waitron-cloud/identity';
import {migrationNames} from './migrate.ts';
import {transaction} from './transaction.ts';

export async function reencryptAuthenticatorKeys(pool: Pool,keys: FactorKeys) {
  // Validate even an empty database; a missing key must never produce a successful rotation receipt.
  encryptFactorSecret('AAAAAAAAAAAAAAAA',keys,{accountId:randomUUID(),version:1,purpose:'active'});
  const report={activeKeyId:keys.activeKeyId,active:0,pending:0};
  const accounts=(await pool.query<{account_id:string}>(`SELECT account_id FROM cloud_authenticator_factors WHERE secret_envelope IS NOT NULL
    UNION SELECT account_id FROM cloud_factor_enrolments ORDER BY account_id`)).rows;
  for(const {account_id:accountId} of accounts) {
    const changed=await transaction(pool,async client=>{
      // Factor management locks the account first. Read child bindings only after that wait.
      await client.query('SELECT id FROM cloud_accounts WHERE id=$1 FOR UPDATE',[accountId]);
      const active=(await client.query<{version:number;secret_envelope:string|null}>(
        'SELECT version,secret_envelope FROM cloud_authenticator_factors WHERE account_id=$1 FOR UPDATE',[accountId])).rows[0];
      const pending=(await client.query<{id:string;token_hash:string;base_version:number;secret_envelope:string}>(
        'SELECT id,token_hash,base_version,secret_envelope FROM cloud_factor_enrolments WHERE account_id=$1 ORDER BY id FOR UPDATE',[accountId])).rows;
      const counts={active:0,pending:0};
      function rewrite(envelope:string,binding:FactorBinding) {
        const secret=decryptFactorSecret(envelope,keys,binding);
        if(secret===null)throw new Error('factor_unavailable');
        if(envelope.split('.')[1]===keys.activeKeyId)return null;
        const next=encryptFactorSecret(secret,keys,binding);
        if(decryptFactorSecret(next,keys,binding)!==secret)throw new Error('factor_unavailable');
        return next;
      }
      if(active?.secret_envelope) {
        const next=rewrite(active.secret_envelope,{accountId,version:active.version,purpose:'active'});
        if(next!==null){await client.query('UPDATE cloud_authenticator_factors SET secret_envelope=$2 WHERE account_id=$1',[accountId,next]);counts.active++;}
      }
      for(const row of pending) {
        const next=rewrite(row.secret_envelope,{accountId,version:row.base_version+1,purpose:'pending',pendingId:row.id});
        if(next!==null){await client.query('UPDATE cloud_factor_enrolments SET secret_envelope=$2 WHERE token_hash=$1',[row.token_hash,next]);counts.pending++;}
      }
      return counts;
    });
    report.active+=changed.active;report.pending+=changed.pending;
  }
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let pool:Pool|undefined;
  try {
    if(process.argv.length!==3||process.argv[2]!=='--reencrypt'||!process.env.DATABASE_URL)throw new Error();
    const keys={activeKeyId:process.env.CLOUD_FACTOR_ACTIVE_KEY_ID!,keys:JSON.parse(process.env.CLOUD_FACTOR_KEYS!)};
    pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
    const rows=(await pool.query<{name:string;digest:string}>('SELECT name,digest FROM schema_migrations')).rows;
    if(rows.length!==migrationNames.length)throw new Error('schema_incompatible');
    for(const name of migrationNames) {
      const digest=createHash('sha256').update(await readFile(new URL(`../migrations/${name}`,import.meta.url))).digest('hex');
      if(!rows.some(row=>row.name===name&&row.digest===digest))throw new Error('schema_incompatible');
    }
    console.log(JSON.stringify(await reencryptAuthenticatorKeys(pool,keys)));
  }catch{console.error('Authenticator key rotation failed; check database, migrations and factor keys');process.exitCode=1;}
  finally{try{await pool?.end();}catch{process.exitCode=1;}}
}
