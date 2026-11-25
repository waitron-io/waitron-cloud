import {randomUUID} from 'node:crypto';
import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {IdentityError,resolveSession} from '@waitron-cloud/identity';
import {recordSecurityAuditEvent,requireAccountActionProof,transaction,type SecurityAuditEventType} from '@waitron-cloud/registration';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
import {readBoundedJsonObject} from './request.ts';

const base='/api/account/operator/venues';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const invalid=()=>new AccountHttpError(400,'invalid_input');
const missing=()=>new AccountHttpError(404,'not_found');
const venueScope=`FROM venues v JOIN legal_businesses b ON b.id=v.legal_business_id AND b.organisation_id=v.organisation_id
 WHERE v.environment='test' AND b.country_code=$1`;
const columns=`v.id,v.display_name AS name,v.organisation_id,
 EXISTS(SELECT 1 FROM address_lookup_stopped_venues WHERE venue_id=v.id) AS stopped`;
const fold=(sql:string)=>String.raw`lower(regexp_replace(normalize(${sql}, NFD), U&'[\0300-\036f]', '', 'g'))`;

type Venue={id:string;name:string|null;organisation_id:string;stopped:boolean};
const publicVenue=({id,name,stopped}:Venue)=>({id,name,stopped});
const audit=(client:PoolClient,venue:Venue,actorId:string,type:SecurityAuditEventType)=>recordSecurityAuditEvent(client,{
 organisationId:venue.organisation_id,venueId:venue.id,type,actorKind:'platform_account',actorId,
 subjectKind:'venue',subjectId:venue.id,sourceId:randomUUID(),
});

type Boundary={pool:Pool;operator:string|undefined;country:string;secure:boolean;origin:string;ip:string;consume:(rules:RateRule[])=>Promise<void>};
export async function operatorVenuesResponse(c:Context,o:Boundary|undefined){
 const path=c.req.path;
 if(!o||path!==base+'/read'&&path!==base+'/address-lookup')throw missing();
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==o.origin)throw new AccountHttpError(403,'forbidden');
 const token=readSessionCookie(c,o.secure)??'',csrfToken=c.req.header('x-csrf-token')??'';
 const authorize=async(client:PoolClient)=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  if(!o.operator||session.accountId!==o.operator)throw new IdentityError('permission_denied');
  return session.accountId;
 };
 const actor=await transaction(o.pool,authorize);
 await o.consume([{scope:'operator-venue-ip',subject:o.ip,limit:20,windowSeconds:60},
  {scope:'operator-venue-account',subject:actor,limit:30,windowSeconds:300}]);
 const body=await readBoundedJsonObject(c.req.raw,1024);
 const venueId=typeof body.venueId==='string'&&uuid.test(body.venueId)?body.venueId:undefined;
 if(path===base+'/address-lookup'){
  const stopped=body.stopped;
  if(!venueId||typeof stopped!=='boolean'||Object.keys(body).length!==2)throw invalid();
  return c.json(await transaction(o.pool,async client=>{
   await requireAccountActionProof(client,token,csrfToken);
   // Admission takes the same venue lock. Read or change the stop row only after acquiring it.
   const {rows:[venue]}=await client.query<Venue>(`SELECT ${columns} ${venueScope} AND v.id=$2 FOR NO KEY UPDATE OF v`,[o.country,venueId]);
   if(!venue)throw missing();
   const change=await client.query(stopped?
    'INSERT INTO address_lookup_stopped_venues(venue_id) VALUES($1) ON CONFLICT DO NOTHING':
    'DELETE FROM address_lookup_stopped_venues WHERE venue_id=$1',[venueId]);
   if(change.rowCount)await audit(client,venue,actor,stopped?'venue.address_lookup_stopped':'venue.address_lookup_allowed');
   await requireAccountActionProof(client,token,csrfToken);
   return publicVenue({...venue,stopped});
  }));
 }
 const query=typeof body.query==='string'?body.query.trim():'';
 if(Object.keys(body).length!==1||(!venueId&&(!/^.{3,80}$/u.test(query)||/[\x00-\x1f\x7f]/.test(query)
   ||!/^.{3,}$/u.test(query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()))))throw invalid();
 return c.json(await transaction(o.pool,async client=>{
  await authorize(client);
  const {rows}=await client.query<Venue>(`SELECT ${columns} ${venueScope}
   ${venueId?'AND v.id=$2':`AND strpos(${fold('v.display_name')},${fold('$2::text')})>0 ORDER BY v.display_name,v.id LIMIT 11`}`,
   [o.country,venueId??query]);
  if(venueId&&!rows.length)throw missing();
  if(rows.length>10)return {venues:[],tooMany:true};
  for(const venue of rows)await audit(client,venue,actor,'venue.viewed');
  await authorize(client);
  return {venues:rows.map(publicVenue)};
 }));
}
