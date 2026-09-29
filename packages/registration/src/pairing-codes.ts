import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {Pool} from 'pg';
import {transaction} from './transaction.ts';

export interface PairingCodeKeys {activeKeyId:string;keys:Readonly<Record<string,string>>;}
export interface PairingCodeBinding {id:string;public_key:string;local_venue_id:string;environment:string;}
const idPattern=/^[A-Za-z0-9_-]{1,64}$/;
const unavailable=()=>new Error('Pairing code configuration unavailable');
export function pairingCodeKeysFromEnv(env:NodeJS.ProcessEnv):PairingCodeKeys|undefined {
  if(env.CLOUD_PAIRING_ACTIVE_KEY_ID===undefined&&env.CLOUD_PAIRING_KEYS===undefined)return undefined;
  try {
    const value={activeKeyId:env.CLOUD_PAIRING_ACTIVE_KEY_ID!,keys:JSON.parse(env.CLOUD_PAIRING_KEYS!)};
    new PairingCodes(value);return value;
  }catch{throw unavailable();}
}
export class PairingCodes {
  readonly #active:string|undefined;
  readonly #keys=new Map<string,Buffer>();
  constructor(config?:PairingCodeKeys) {
    if(config===undefined)return;
    if(typeof config.activeKeyId!=='string'||!idPattern.test(config.activeKeyId)||!config.keys||typeof config.keys!=='object'||Array.isArray(config.keys))throw unavailable();
    for(const [id,key] of Object.entries(config.keys)) {
      if(!idPattern.test(id)||typeof key!=='string'||!/^[a-fA-F0-9]{64}$/.test(key))throw unavailable();
      this.#keys.set(id,Buffer.from(key,'hex'));
    }
    if(!this.#keys.has(config.activeKeyId))throw unavailable();
    this.#active=config.activeKeyId;
  }
  #mac(row:PairingCodeBinding,digest:string,keyId:string):string {
    const key=this.#keys.get(keyId);if(!key)throw unavailable();
    return createHmac('sha256',key).update(JSON.stringify(['waitron-cloud/pairing-code/v1',row.id.toLowerCase(),row.public_key,row.local_venue_id.toLowerCase(),row.environment,digest])).digest('hex');
  }
  protectDigest(row:PairingCodeBinding,digest:string):string {
    if(!this.#active||!/^[a-f0-9]{64}$/.test(digest))throw unavailable();
    return `v1:${this.#active}:${this.#mac(row,digest,this.#active)}`;
  }
  protect(row:PairingCodeBinding,code:string):string {
    return this.protectDigest(row,createHash('sha256').update(code).digest('hex'));
  }
  matches(row:PairingCodeBinding,stored:string,code:string):boolean {
    const match=/^v1:([A-Za-z0-9_-]{1,64}):([a-f0-9]{64})$/.exec(stored);
    // Legacy hashes never enable a database-only guessing oracle in request handlers.
    if(!match)throw unavailable();
    const expected=this.#mac(row,createHash('sha256').update(code).digest('hex'),match[1]!);
    return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(match[2]!,'hex'));
  }
}
/** Wrap legacy digests without changing approvals, expiry, attempts or completed results. */
export async function upgradePairingCodes(pool:Pool,keys:PairingCodeKeys,batchSize=100):Promise<number> {
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>1000)throw unavailable();
  const codes=new PairingCodes(keys);
  return transaction(pool,async client=>{
    const rows=(await client.query<PairingCodeBinding&{code_hash:string}>(`SELECT id,public_key,local_venue_id,environment,code_hash FROM pairing_requests
      WHERE code_hash ~ '^[a-f0-9]{64}$' ORDER BY id LIMIT $1 FOR UPDATE`,[batchSize])).rows;
    for(const row of rows)await client.query('UPDATE pairing_requests SET code_hash=$2 WHERE id=$1',[row.id,codes.protectDigest(row,row.code_hash)]);
    return rows.length;
  });
}
