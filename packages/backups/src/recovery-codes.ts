import type {Pool} from 'pg';
import {transaction} from '@waitron-cloud/registration';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

export interface RecoveryCodeKeys {activeKeyId:string;keys:Readonly<Record<string,string>>;}
export interface RecoveryCodeBinding {id:string;public_key:string;}
const idPattern=/^[A-Za-z0-9_-]{1,64}$/;
const unavailable=()=>new Error('Recovery code configuration unavailable');
export function recoveryCodeKeysFromEnv(env:NodeJS.ProcessEnv):RecoveryCodeKeys|undefined {
  if(env.CLOUD_RECOVERY_ACTIVE_KEY_ID===undefined&&env.CLOUD_RECOVERY_KEYS===undefined)return undefined;
  try {
    const value={activeKeyId:env.CLOUD_RECOVERY_ACTIVE_KEY_ID!,keys:JSON.parse(env.CLOUD_RECOVERY_KEYS!)};
    new RecoveryCodes(value);return value;
  }catch{throw unavailable();}
}
export class RecoveryCodes {
  readonly #active:string|undefined;
  readonly #keys=new Map<string,Buffer>();
  constructor(config?:RecoveryCodeKeys) {
    if(config===undefined)return;
    if(typeof config.activeKeyId!=='string'||!idPattern.test(config.activeKeyId)||!config.keys||typeof config.keys!=='object'||Array.isArray(config.keys))throw unavailable();
    for(const [id,key] of Object.entries(config.keys)) {
      if(!idPattern.test(id)||typeof key!=='string'||!/^[a-fA-F0-9]{64}$/.test(key))throw unavailable();
      this.#keys.set(id,Buffer.from(key,'hex'));
    }
    if(!this.#keys.has(config.activeKeyId))throw unavailable();
    this.#active=config.activeKeyId;
  }
  #mac(row:RecoveryCodeBinding,digest:string,keyId:string):string {
    const key=this.#keys.get(keyId);if(!key)throw unavailable();
    return createHmac('sha256',key).update(JSON.stringify(['waitron-cloud/recovery-code/v1',row.id.toLowerCase(),row.public_key,digest])).digest('hex');
  }
  protectDigest(row:RecoveryCodeBinding,digest:string):string {
    if(!this.#active||!/^[a-f0-9]{64}$/.test(digest))throw unavailable();
    return `v1:${this.#active}:${this.#mac(row,digest,this.#active)}`;
  }
  protect(row:RecoveryCodeBinding,code:string):string {
    return this.protectDigest(row,createHash('sha256').update(code).digest('hex'));
  }
  matches(row:RecoveryCodeBinding,stored:string,code:string):boolean {
    const match=/^v1:([A-Za-z0-9_-]{1,64}):([a-f0-9]{64})$/.exec(stored);
    // Legacy hashes never enable a database-only guessing oracle in request handlers.
    if(!match)throw unavailable();
    const expected=this.#mac(row,createHash('sha256').update(code).digest('hex'),match[1]!);
    return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(match[2]!,'hex'));
  }
}
/** Wrap legacy digests without changing approvals, expiry, attempts or completed results. */
export async function upgradeRecoveryCodes(pool:Pool,keys:RecoveryCodeKeys,batchSize=100):Promise<number> {
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>1000)throw unavailable();
  const codes=new RecoveryCodes(keys);
  return transaction(pool,async client=>{
    const rows=(await client.query<RecoveryCodeBinding&{code_hash:string}>(`SELECT id,public_key,code_hash FROM backup_recovery_requests
      WHERE code_hash ~ '^[a-f0-9]{64}$' ORDER BY id LIMIT $1 FOR UPDATE`,[batchSize])).rows;
    for(const row of rows)await client.query('UPDATE backup_recovery_requests SET code_hash=$2 WHERE id=$1',[row.id,codes.protectDigest(row,row.code_hash)]);
    return rows.length;
  });
}
