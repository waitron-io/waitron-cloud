import type {Pool,PoolClient} from 'pg';
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
