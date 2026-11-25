import {createServer} from 'node:http';
import {isUuid} from './manifest.ts';
import {matchGuestMenuLanguage} from './guest-menu-match.ts';
import {isGuestMenuLanguage} from './guest-menu-language.ts';
import {Pool,type PoolClient,type PoolConfig} from 'pg';
import {createHash} from 'node:crypto';
import {createLeaseTrust,effectiveVenueLevel,InstallationError,readMachineClaims,transaction,verifyMachine,verifyLease,type BillingLevel,type LeaseIssuer,type PlanMode,type TrialView} from '@waitron-cloud/registration';
export interface GuestMenuView {
 version:1;url:string;revision:number;state:'off'|'current'|'blocked';
 planRequired?:true;
 publication:null|{bodySha256:string;defaultLanguage:string;receivedAt:string};
}
type GuestMenuStatus=Omit<GuestMenuView,'url'>&{url:string|null};
export function guestMenuStatus(client:PoolClient,venueId:string,origin:string):Promise<GuestMenuView>;
export function guestMenuStatus(client:PoolClient,venueId:string,origin:string|null):Promise<GuestMenuStatus>;
export async function guestMenuStatus(client:PoolClient,venueId:string,origin:string|null):Promise<GuestMenuStatus>{
 const row=(await client.query('SELECT revision,state,body_sha256,default_language,received_at FROM guest_menus WHERE venue_id=$1',[venueId])).rows[0];
 return {version:1,url:origin===null?null:`${origin}/m/${venueId}`,revision:Number(row?.revision??0),state:row?.state??'off',publication:row?.state==='current'
  ?{bodySha256:row.body_sha256,defaultLanguage:row.default_language,receivedAt:row.received_at.toISOString()}:null};
}
/** The venue parent lock also serialises the first publish with a takedown on an absent row. */
export async function writeGuestMenuBlocked(client:PoolClient,venueId:string,blocked:boolean):Promise<void>{
 await client.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[venueId]);
 if(blocked)await client.query(`INSERT INTO guest_menus(venue_id,revision,state) VALUES($1,1,'blocked')
  ON CONFLICT(venue_id) DO UPDATE SET revision=guest_menus.revision+1,state='blocked',source_installation_id=NULL,
  body_sha256=NULL,default_language=NULL,received_at=NULL,pages=NULL WHERE guest_menus.state<>'blocked'`,[venueId]);
 else await client.query("UPDATE guest_menus SET revision=revision+1,state='off' WHERE venue_id=$1 AND state='blocked'",[venueId]);
}
export async function setGuestMenuBlocked(client:PoolClient,venueId:string,blocked:boolean,origin:string):Promise<GuestMenuView>{
 await writeGuestMenuBlocked(client,venueId,blocked);
 return guestMenuStatus(client,venueId,origin);
}
export async function readGuestMenu(client:Pick<Pool,'query'>,venueId:string,language?:string|readonly string[]):Promise<{html:string;revision:number;language:string}|null>{
 const row=(await client.query("SELECT revision,default_language,pages FROM guest_menus WHERE venue_id=$1 AND state='current'",[venueId])).rows[0];
 if(!row)return null;
 // jsonb has no saved key order; the main page wins ties, then byte-sorted keys.
 const offered=[row.default_language,...Object.keys(row.pages??{}).filter(key=>key!==row.default_language).sort()];
 const selected=matchGuestMenuLanguage(typeof language==='string'?[language]:language??[],offered)??row.default_language,html=row.pages?.[selected];
 if(typeof html!=='string'||Buffer.byteLength(html)>2097152)throw Error('guest_menu_unavailable');
 return {html,revision:Number(row.revision),language:selected};
}

type GuestMenuRelease={revision:string|null;state:GuestMenuView['state']|null;eligible:boolean};
export async function readGuestMenuRelease(client:Pick<Pool,'query'>,venueId:string,mode?:PlanMode):Promise<GuestMenuRelease|undefined>{
 if(mode!=='test-venue-levels'){
  return (await client.query<GuestMenuRelease>('SELECT revision,state,true AS eligible FROM guest_menus WHERE venue_id=$1',[venueId])).rows[0];
 }
 // Older billing rows grant access only after the venue enrolls in this billing mode.
 const row=(await client.query<Omit<GuestMenuRelease,'eligible'>&{environment:string;level:BillingLevel;trials:TrialView[];today:string}>(`
  SELECT m.revision,m.state,v.environment,COALESCE(b.level,'registered') AS level,
   (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('level',t.level,'startedOn',t.started_on::text,'endsOn',t.ends_on::text,
     'extended',t.extended,'state',t.state)) FROM billing_trials t
     WHERE (t.organisation_id,t.legal_business_id,t.venue_id)=(a.organisation_id,a.legal_business_id,a.venue_id)),'[]'::jsonb) AS trials
  FROM venues v
  LEFT JOIN billing_service_authority a ON (a.organisation_id,a.legal_business_id,a.venue_id)=(v.organisation_id,v.legal_business_id,v.id)
  LEFT JOIN billing_venues b ON (b.organisation_id,b.legal_business_id,b.venue_id)=(a.organisation_id,a.legal_business_id,a.venue_id)
  LEFT JOIN guest_menus m ON m.venue_id=v.id
  WHERE v.id=$1`,[venueId])).rows[0];
 if(!row)return undefined;
 const {revision,state,environment,level,trials,today}=row;
 return {revision,state,eligible:environment==='test'&&effectiveVenueLevel(level,trials,today)!=='registered'};
}

export async function startGuestMenuAuthority(database:PoolConfig,host:string,port:number){
 const pool=new Pool({...database,max:4,connectionTimeoutMillis:250,statement_timeout:650,query_timeout:700});
 pool.on('error',()=>console.error('Guest menu authority database connection failed'));
 const server=createServer({maxHeaderSize:8192,headersTimeout:1000,requestTimeout:1000,connectionsCheckingInterval:100},async(req,res)=>{
  const path=req.url??'',id=path.slice('/guest-menu/'.length);
  let status=404;
  if(req.method==='GET'&&path.startsWith('/guest-menu/')&&isUuid(id)){
   // The dedicated pool bounds the number of queries and the time spent waiting for a connection.
   status=503;
   if(pool.waitingCount<16){
    try{
     const current=await readGuestMenuRelease(pool,id,'test-venue-levels');
     status=current?.eligible&&current.state!=='blocked'?204:404;
    }catch{}
   }
  }
  if(!res.destroyed)res.writeHead(status,{'cache-control':'no-store'}).end();
 });
 try{
  await new Promise<void>((resolve,reject)=>{
   server.once('error',reject);
   server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});
  });
 }catch(error){
  await pool.end();
  throw error;
 }
 const address=server.address();
 if(!address||typeof address==='string')throw Error('guest_menu_authority_address');
 return {port:address.port,async close(){
  try{
   await new Promise<void>((resolve,reject)=>{
    server.close(error=>error?reject(error):resolve());server.closeAllConnections();
   });
  }finally{await pool.end();}
 }};
}

export type GuestMenuAction='guest-menu-publish'|'guest-menu-status'|'guest-menu-withdraw';
export class GuestMenuError extends Error {
 readonly code:'invalid_input'|'forbidden'|'too_large'|'conflict'|'blocked'|'guest_menu_plan_required';
 constructor(code:GuestMenuError['code']){super(code);this.code=code;}
}
function fail(code:GuestMenuError['code']):never{throw new GuestMenuError(code);}
function object(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function publication(signed:string,body:string|undefined){
 let value:unknown;try{value=JSON.parse(signed);}catch{return fail('invalid_input');}
 if(!object(value,['version','expectedRevision','bodySha256','bodyBytes'])||value.version!==1
  ||!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<0||!Number.isSafeInteger(value.bodyBytes)||Number(value.bodyBytes)<1
  ||typeof value.bodySha256!=='string'||!/^[a-f0-9]{64}$/.test(value.bodySha256))return fail('invalid_input');
 if(Number(value.bodyBytes)>2097152)return fail('too_large');
 if(typeof body!=='string'||!(body as string&{isWellFormed():boolean}).isWellFormed()||Buffer.byteLength(body)!==value.bodyBytes
  ||createHash('sha256').update(body).digest('hex')!==value.bodySha256)return fail('forbidden');
 let menu:unknown;try{menu=JSON.parse(body);}catch{return fail('invalid_input');}
 if(!object(menu,['defaultLanguage','pages'])||!isGuestMenuLanguage(menu.defaultLanguage)
  ||!menu.pages||typeof menu.pages!=='object'||Array.isArray(menu.pages))return fail('invalid_input');
 const pages=menu.pages as Record<string,unknown>;
 if(typeof pages[menu.defaultLanguage]!=='string'||Object.entries(pages).some(([lang,html])=>!isGuestMenuLanguage(lang)||typeof html!=='string'||!(html as string&{isWellFormed():boolean}).isWellFormed()||html.includes('\u0000')))return fail('invalid_input');
 return {revision:Number(value.expectedRevision),digest:value.bodySha256,defaultLanguage:menu.defaultLanguage,pages};
}
export class GuestMenuMachine {
 readonly #pool:Pool;readonly #origin:string;readonly #guestOrigin:string;readonly #trusted:ReadonlyMap<string,string>;readonly #planMode?:PlanMode;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,guestOrigin:string,trusted=createLeaseTrust(issuer),planMode?:PlanMode){
  this.#pool=pool;this.#origin=origin;this.#guestOrigin=guestOrigin;this.#trusted=trusted;this.#planMode=planMode;
 }
 async execute(action:GuestMenuAction,envelope:unknown,body?:string):Promise<GuestMenuView>{
  const routing=readMachineClaims(envelope);
  return transaction(this.#pool,async client=>{
   const initial=(await client.query('SELECT public_key,venue_id FROM installations WHERE id=$1',[routing.installationId])).rows[0];
   if(!initial)throw new InstallationError('invalid_proof');verifyMachine(envelope,initial.public_key,this.#origin,action);
   // All menu writers lock the parent before the installation and menu row, including first publication.
   const venue=(await client.query('SELECT environment FROM venues WHERE id=$1 FOR NO KEY UPDATE',[initial.venue_id])).rows[0];
   const row=(await client.query('SELECT * FROM installations WHERE id=$1 FOR UPDATE',[routing.installationId])).rows[0];
   if(!row||!venue||row.venue_id!==initial.venue_id)throw new InstallationError('invalid_proof');
   const verify=()=>{
    const claims=verifyMachine(envelope,row.public_key,this.#origin,action);
    if(row.revoked_at||row.superseded_by)throw new InstallationError('revoked');
    let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
    if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
    const lease=verifyLease(encoded,this.#trusted,this.#origin);
    if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.environment!==venue.environment||lease.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
    return claims;
   };
   const claims=verify();
   const planRequired=this.#planMode==='test-venue-levels'&&action!=='guest-menu-withdraw'
    &&!(await readGuestMenuRelease(client,row.venue_id,this.#planMode))?.eligible;
   let current=await guestMenuStatus(client,row.venue_id,this.#guestOrigin);
   if(action==='guest-menu-publish'){
    const menu=publication(claims.body,body);
    if(current.state==='blocked')return fail('blocked');
    if(planRequired)return fail('guest_menu_plan_required');
    if(current.state!=='current'||current.publication?.bodySha256!==menu.digest||current.publication.defaultLanguage!==menu.defaultLanguage){
     if(current.revision!==menu.revision)return fail('conflict');
     await client.query(`INSERT INTO guest_menus(venue_id,revision,state,source_installation_id,body_sha256,default_language,received_at,pages)
      VALUES($1,1,'current',$2,$3,$4,clock_timestamp(),$5)
      ON CONFLICT(venue_id) DO UPDATE SET revision=guest_menus.revision+1,state='current',source_installation_id=EXCLUDED.source_installation_id,
      body_sha256=EXCLUDED.body_sha256,default_language=EXCLUDED.default_language,received_at=EXCLUDED.received_at,pages=EXCLUDED.pages`,[row.venue_id,row.id,menu.digest,menu.defaultLanguage,JSON.stringify(menu.pages)]);
    }
   }else{
    let value:unknown;try{value=JSON.parse(claims.body);}catch{return fail('invalid_input');}
    if(!object(value,['version'])||value.version!==1)return fail('invalid_input');
    if(action==='guest-menu-withdraw')await client.query(`UPDATE guest_menus SET revision=revision+1,state='off',source_installation_id=NULL,
     body_sha256=NULL,default_language=NULL,received_at=NULL,pages=NULL WHERE venue_id=$1 AND state='current'`,[row.venue_id]);
   }
   current=await guestMenuStatus(client,row.venue_id,this.#guestOrigin);verify();
   return planRequired?{...current,planRequired:true}:current;
  });
 }
}
