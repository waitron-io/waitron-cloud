import {randomUUID} from 'node:crypto';
import {organisationScopeSql,resolveSession} from '@waitron-cloud/identity';
import {normaliseEmail,readVenuePermissions,transaction} from '@waitron-cloud/registration';
import {boundedResolveCname,type ResolveCname} from '@waitron-cloud/remote-access/dns-lookup';
import {isHostname,isUuid} from '@waitron-cloud/remote-access/manifest';
import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
import {readAccountBody} from './request.ts';

interface VenueEmailRow {waitron_mail_reply_to:string|null;waitron_mail_from:string|null;waitron_mail_dns_token:string|null}
interface DnsAlias {type:'CNAME';name:string;value:string}
interface VenueEmailSettings {replyTo:string|null;domain?:{address:string|null;records:DnsAlias[]}}
const domainOf=(address:string)=>address.split('@')[1]!;
const under=(name:string,suffix:string)=>name===suffix||name.endsWith('.'+suffix);

export async function readVenueEmailSettings(client:PoolClient,venueId:string,installationId:string,suffix?:string):Promise<VenueEmailSettings>{
 const row=(await client.query<VenueEmailRow>(`SELECT waitron_mail_reply_to,waitron_mail_from,waitron_mail_dns_token
  FROM venues WHERE id=$1`,[venueId])).rows[0]!;
 const settings={replyTo:row.waitron_mail_reply_to};
 if(!suffix)return settings;
 const address=row.waitron_mail_from,token=row.waitron_mail_dns_token,records:DnsAlias[]=[];
 if(address&&token)records.push({type:'CNAME',name:`${token}._domainkey.${domainOf(address)}`,value:`${token}.mail.${suffix}`});
 const aliases=(await client.query<{hostname:string;assigned_hostname:string}>(`SELECT h.hostname,h.assigned_hostname
  FROM remote_placements p JOIN remote_hostnames h USING(venue_id)
  WHERE p.installation_id=$1 AND p.venue_id=$2 AND h.hostname<>h.assigned_hostname ORDER BY h.kind DESC`,[installationId,venueId])).rows;
 for(const alias of aliases)records.push({type:'CNAME',name:alias.hostname,value:alias.assigned_hostname});
 return {...settings,domain:{address,records}};
}

async function checkAlias(record:DnsAlias,resolve?:ResolveCname){
 try{
  const targets=await boundedResolveCname(record.name,resolve);
  return targets.length===1&&targets[0]!.toLowerCase().replace(/\.$/,'')===record.value?'verified':'unverified';
 }catch(error){
  return ['ENOTFOUND','ENODATA'].includes((error as NodeJS.ErrnoException)?.code??'')?'unverified':'unknown';
 }
}

export async function venueEmailResponse(c:Context, options:{pool:Pool;origin:string;secure:boolean;ip:string;suffix?:string;resolve?:ResolveCname;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 const {pool,origin,secure,ip,consume,suffix,resolve}=options,action=c.req.path.slice('/api/account/venue-email/'.length);
 if(action!=='save'&&(!suffix||(action!=='save-domain'&&action!=='check-dns')))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 await consume([{scope:'venue-email-ip',subject:ip,limit:60,windowSeconds:60}]);
 const body=await readAccountBody(c.req.raw,action==='save'?['installationId','replyTo']:action==='save-domain'?['installationId','address']:['installationId']);
 const installationId=body.installationId!,address=action==='save-domain'?normaliseEmail(body.address):undefined;
 const replyTo=body.replyTo===''?null:normaliseEmail(body.replyTo);
 const domain=address?domainOf(address):undefined;
 if(!isUuid(installationId)||(action==='save'&&replyTo===undefined)||(action==='save-domain'&&(!domain||!isHostname(domain)||domain.length>205)))throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,secure)??'',csrfToken=c.req.header('x-csrf-token')??'';
 const authorize=async(client:PoolClient)=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  const venue=(await client.query<{id:string;organisation_id:string}>(`SELECT v.id,v.organisation_id
   FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id JOIN installations i ON i.venue_id=v.id
   WHERE i.id=$1 AND v.environment='test' AND m.account_id=$2 AND m.is_owner AND ${organisationScopeSql('m.account_id','m.organisation_id')}
   FOR SHARE OF m`,[installationId,session.accountId])).rows[0];
  if(!venue)throw new AccountHttpError(403,'permission_denied');
  // Hold venue policy and active installation through the write or read, in that order.
  const permission=await readVenuePermissions(client,venue.id,'test-venue-levels');
  const active=(await client.query(`SELECT 1 FROM installations WHERE id=$1 AND venue_id=$2
   AND revoked_at IS NULL AND superseded_by IS NULL FOR SHARE`,[installationId,venue.id])).rowCount;
  if(!active||permission.organisationId!==venue.organisation_id)throw new AccountHttpError(403,'permission_denied');
  if(permission.level!=='connected'&&permission.level!=='hosted')throw new AccountHttpError(403,'venue_email_connected_required');
  return {venueId:venue.id,accountId:session.accountId};
 };
 if(action==='check-dns'){
  const read=()=>transaction(pool,async client=>{
   const {venueId,accountId}=await authorize(client);
   return {accountId,settings:await readVenueEmailSettings(client,venueId,installationId,suffix)};
  });
  const before=await read();
  await consume([{scope:'venue-email-dns-account',subject:before.accountId,limit:15,windowSeconds:60}]);
  const {domain}=before.settings;if(!domain)throw new AccountHttpError(404,'not_found');
  const records=await Promise.all(domain.records.map(async alias=>({...alias,status:await checkAlias(alias,resolve)})));
  const {settings}=await read();
  if(JSON.stringify(domain)!==JSON.stringify(settings.domain))throw new AccountHttpError(409,'conflict');
  return c.json({...settings,domain:{...domain,records}});
 }
 return c.json(await transaction(pool,async client=>{
  const {venueId}=await authorize(client);
  if(domain&&suffix){
   const reserved=['waitron.io','waitron.cloud',suffix].some(zone=>under(domain,zone));
   if(reserved||(await client.query(`SELECT suffix FROM remote_cells WHERE $1=suffix OR right($1,length(suffix)+1)='.'||suffix
    UNION ALL SELECT suffix FROM remote_country_zones WHERE $1=suffix OR right($1,length(suffix)+1)='.'||suffix`,[domain])).rowCount){
    throw new AccountHttpError(400,'invalid_input');
   }
   await client.query(`UPDATE venues SET waitron_mail_from=$2,waitron_mail_dns_token=
    CASE WHEN split_part(waitron_mail_from,'@',2)=$3 THEN waitron_mail_dns_token ELSE $4 END WHERE id=$1`,[venueId,address,domain,randomUUID()]);
  }else if(replyTo===null){
   await client.query(`UPDATE venues SET waitron_mail_reply_to=NULL,waitron_mail_from=NULL,waitron_mail_dns_token=NULL
    WHERE id=$1`,[venueId]);
  }else{
   await client.query('UPDATE venues SET waitron_mail_reply_to=$2 WHERE id=$1',[venueId,replyTo]);
  }
  return readVenueEmailSettings(client,venueId,installationId,suffix);
 }));
}
