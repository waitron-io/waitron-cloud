import type {Pool,PoolClient} from 'pg';
import {createHash} from 'node:crypto';
import {createLeaseTrust,InstallationError,readMachineClaims,transaction,verifyMachine,verifyLease,type LeaseIssuer} from '@waitron-cloud/registration';
export interface GuestMenuView {
 version:1;url:string;revision:number;state:'off'|'current'|'blocked';
 publication:null|{bodySha256:string;defaultLanguage:string;receivedAt:string};
}
export async function guestMenuStatus(client:PoolClient,venueId:string,origin:string):Promise<GuestMenuView>{
 const row=(await client.query('SELECT revision,state,body_sha256,default_language,received_at FROM guest_menus WHERE venue_id=$1',[venueId])).rows[0];
 return {version:1,url:`${origin}/m/${venueId}`,revision:Number(row?.revision??0),state:row?.state??'off',publication:row?.state==='current'
  ?{bodySha256:row.body_sha256,defaultLanguage:row.default_language,receivedAt:row.received_at.toISOString()}:null};
}
/** The venue parent lock also serialises the first publish with a takedown on an absent row. */
export async function setGuestMenuBlocked(client:PoolClient,venueId:string,blocked:boolean,origin:string):Promise<GuestMenuView>{
 await client.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[venueId]);
 if(blocked)await client.query(`INSERT INTO guest_menus(venue_id,revision,state) VALUES($1,1,'blocked')
  ON CONFLICT(venue_id) DO UPDATE SET revision=guest_menus.revision+1,state='blocked',source_installation_id=NULL,
  body_sha256=NULL,default_language=NULL,received_at=NULL,pages=NULL WHERE guest_menus.state<>'blocked'`,[venueId]);
 else await client.query("UPDATE guest_menus SET revision=revision+1,state='off' WHERE venue_id=$1 AND state='blocked'",[venueId]);
 return guestMenuStatus(client,venueId,origin);
}
export async function readGuestMenu(client:Pick<Pool,'query'>,venueId:string,language?:string):Promise<{html:string;revision:number;language:string}|null>{
 const row=(await client.query("SELECT revision,default_language,pages FROM guest_menus WHERE venue_id=$1 AND state='current'",[venueId])).rows[0];
 if(!row)return null;
 const selected=language&&row.pages?.[language]!==undefined?language:row.default_language,html=row.pages?.[selected];
 if(typeof html!=='string'||Buffer.byteLength(html)>2097152)throw Error('guest_menu_unavailable');
 return {html,revision:Number(row.revision),language:selected};
}

export type GuestMenuAction='guest-menu-publish'|'guest-menu-status'|'guest-menu-withdraw';
export class GuestMenuError extends Error {
 readonly code:'invalid_input'|'forbidden'|'too_large'|'conflict'|'blocked';
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
 const languages=['en','es','ca','gl'];
 if(!object(menu,['defaultLanguage','pages'])||typeof menu.defaultLanguage!=='string'||!languages.includes(menu.defaultLanguage)
  ||!menu.pages||typeof menu.pages!=='object'||Array.isArray(menu.pages))return fail('invalid_input');
 const pages=menu.pages as Record<string,unknown>;
 if(typeof pages[menu.defaultLanguage]!=='string'||Object.entries(pages).some(([lang,html])=>!languages.includes(lang)||typeof html!=='string'))return fail('invalid_input');
 return {revision:Number(value.expectedRevision),digest:value.bodySha256,defaultLanguage:menu.defaultLanguage,pages};
}
export class GuestMenuMachine {
 readonly #pool:Pool;readonly #origin:string;readonly #guestOrigin:string;readonly #trusted:ReadonlyMap<string,string>;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,guestOrigin:string,trusted=createLeaseTrust(issuer)){
  this.#pool=pool;this.#origin=origin;this.#guestOrigin=guestOrigin;this.#trusted=trusted;
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
   let current=await guestMenuStatus(client,row.venue_id,this.#guestOrigin);
   if(action==='guest-menu-publish'){
    const menu=publication(claims.body,body);
    if(current.state==='blocked')return fail('blocked');
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
   current=await guestMenuStatus(client,row.venue_id,this.#guestOrigin);verify();return current;
  });
 }
}
