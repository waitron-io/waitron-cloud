import {createHmac} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {RelayKeyConfig} from './relay-payload.ts';
import {normaliseEmail} from './account-input.ts';

export interface RelayBoundsConfig {
 version:string;epoch:string;windowSeconds:number;recipientLimit:number;grantLimit:number;
 queuedPayloadBytes:number;maxCounterRows:number;recipientKeys:RelayKeyConfig;
}
export class RelayBoundsError extends Error {
 readonly code:'rate_limited'|'relay_unavailable';
 constructor(code:RelayBoundsError['code']){super(code);this.code=code;}
}
function fail(code:RelayBoundsError['code']='relay_unavailable'):never{throw new RelayBoundsError(code);}
function exact(v:unknown,fields:string[]):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===fields.sort().join(',');}
export const relayBoundsLock="SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('relay-admission-bounds'))";
async function requireTransaction(c:PoolClient){
 try{await c.query('SAVEPOINT relay_bounds_transaction');}catch(e){if((e as {code?:string}).code==='25P01')fail();throw e;}
 await c.query('RELEASE SAVEPOINT relay_bounds_transaction');
}
export async function pruneRelayBounds(c:PoolClient,limit:number,cutoff?:string):Promise<number>{
 await requireTransaction(c);await c.query(relayBoundsLock);
 if(!Number.isSafeInteger(limit)||limit<1)fail();
 // Delete counters before their window so each chunk bounds rows removed, including windows.
 const counters=await c.query(`WITH selected AS (SELECT b.window_start,b.kind,b.subject FROM relay_bounds_counters b
  JOIN relay_bounds_windows w ON w.window_start=b.window_start WHERE w.ends_at<=clock_timestamp()
  AND ($2::timestamptz IS NULL OR w.ends_at<$2) ORDER BY w.ends_at,b.kind,b.subject LIMIT $1)
  DELETE FROM relay_bounds_counters b USING selected s WHERE b.window_start=s.window_start AND b.kind=s.kind AND b.subject=s.subject`,[limit,cutoff??null]);
 const removed=counters.rowCount??0;
 if(removed===limit)return removed;
 const windows=await c.query(`WITH selected AS (SELECT w.window_start FROM relay_bounds_windows w WHERE w.ends_at<=clock_timestamp()
  AND ($2::timestamptz IS NULL OR w.ends_at<$2) AND NOT EXISTS(SELECT 1 FROM relay_bounds_counters b WHERE b.window_start=w.window_start)
  ORDER BY w.ends_at LIMIT $1) DELETE FROM relay_bounds_windows w USING selected s WHERE w.window_start=s.window_start`,[limit-removed,cutoff??null]);
 return removed+(windows.rowCount??0);
}
export class RelayBounds {
 readonly #pool:Pool;readonly #policy:Omit<RelayBoundsConfig,'recipientKeys'>;readonly #keys=new Map<string,Buffer>();readonly #active:string;
 constructor(pool:Pool,config:RelayBoundsConfig){
  if(!exact(config,['version','epoch','windowSeconds','recipientLimit','grantLimit','queuedPayloadBytes','maxCounterRows','recipientKeys'])
   ||typeof config.version!=='string'||!/^[a-zA-Z0-9_.:-]{1,100}$/.test(config.version)
   ||typeof config.epoch!=='string'||!Number.isFinite(Date.parse(config.epoch))||new Date(config.epoch).toISOString()!==config.epoch)fail();
  for(const key of ['windowSeconds','recipientLimit','grantLimit','queuedPayloadBytes','maxCounterRows'] as const){if(!Number.isSafeInteger(config[key])||config[key]<1)fail();}
  if(config.maxCounterRows<3||!Number.isSafeInteger(config.windowSeconds*1000))fail();
  const ring=config.recipientKeys;
  if(!exact(ring,['activeKeyId','keys'])||!ring.keys||typeof ring.keys!=='object'||Array.isArray(ring.keys))fail();
  for(const [id,key] of Object.entries(ring.keys)){
   if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||typeof key!=='string'||!/^[a-fA-F0-9]{64}$/.test(key))fail();
   this.#keys.set(id,Buffer.from(key,'hex'));
  }
  if(typeof ring.activeKeyId!=='string'||!this.#keys.has(ring.activeKeyId))fail();
  this.#active=ring.activeKeyId;this.#pool=pool;
  const {recipientKeys,...policy}=config;this.#policy={...policy};
 }
 #hmac(id:string,domain:string,value?:string):string{
  const key=this.#keys.get(id);if(!key)fail();
  return createHmac('sha256',key).update(JSON.stringify(value===undefined?[domain]:[domain,value])).digest('hex');
 }
 async check(c:PoolClient):Promise<void>{
  await requireTransaction(c);await c.query(relayBoundsLock);
  await c.query('INSERT INTO relay_bounds_policy(singleton,definition) VALUES(true,$1) ON CONFLICT DO NOTHING',[this.#policy]);
  if(!(await c.query('SELECT 1 FROM relay_bounds_policy WHERE singleton AND definition=$1::jsonb',[this.#policy])).rowCount)fail();
  const time=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
  if(time<Date.parse(this.#policy.epoch))fail();
  for(const w of (await c.query('SELECT key_id,key_verifier FROM relay_bounds_windows WHERE ends_at>clock_timestamp()')).rows){
   if(this.#hmac(w.key_id,'relay-recipient-key-verifier-v1')!==w.key_verifier)fail();
  }
 }
 async reserve(c:PoolClient,input:{grantId:string;recipient:string}):Promise<Date>{
  await this.check(c);await this.prune(c,this.#policy.maxCounterRows);
  if(normaliseEmail(input.recipient)!==input.recipient||!/^[0-9a-f-]{36}$/i.test(input.grantId))fail();
  const time=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
  const epoch=Date.parse(this.#policy.epoch),duration=this.#policy.windowSeconds*1000;
  const start=new Date(epoch+Math.floor((time-epoch)/duration)*duration),end=new Date(start.getTime()+duration);
  if(!Number.isFinite(end.getTime()))fail();
  const prior=(await c.query('SELECT key_id FROM relay_bounds_windows WHERE window_start=$1',[start])).rows[0];
  const id=prior?.key_id??this.#active;
  const subjects=[['recipient',this.#hmac(id,'relay-recipient-budget-v1',input.recipient),this.#policy.recipientLimit],['grant',input.grantId,this.#policy.grantLimit]] as const;
  let needed=prior?0:1;
  for(const [kind,subject,limit] of subjects){
   const found=(await c.query('SELECT count FROM relay_bounds_counters WHERE window_start=$1 AND kind=$2 AND subject=$3',[start,kind,subject])).rows[0];
   if(found&&Number(found.count)>=limit)fail('rate_limited');if(!found)needed++;
  }
  const rows=Number((await c.query('SELECT (SELECT count(*) FROM relay_bounds_windows)+(SELECT count(*) FROM relay_bounds_counters) AS count')).rows[0].count);
  if(rows+needed>this.#policy.maxCounterRows)fail('rate_limited');
  if(!prior)await c.query('INSERT INTO relay_bounds_windows(window_start,ends_at,key_id,key_verifier) VALUES($1,$2,$3,$4)',[start,end,id,this.#hmac(id,'relay-recipient-key-verifier-v1')]);
  for(const [kind,subject] of subjects)await c.query(`INSERT INTO relay_bounds_counters(window_start,kind,subject,count) VALUES($1,$2,$3,1)
   ON CONFLICT(window_start,kind,subject) DO UPDATE SET count=relay_bounds_counters.count+1`,[start,kind,subject]);
  return end;
 }
 async prune(c:PoolClient,limit:number):Promise<number>{return pruneRelayBounds(c,limit);}
 async status():Promise<{retainedPayloadBytes:string;counterRows:number}>{
  const r=(await this.#pool.query(`SELECT (SELECT bytes::text FROM relay_queue_bytes WHERE singleton) AS bytes,
   ((SELECT count(*) FROM relay_bounds_windows)+(SELECT count(*) FROM relay_bounds_counters))::integer AS rows`)).rows[0];
  return {retainedPayloadBytes:r.bytes,counterRows:r.rows};
 }
}
