import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readVenuePermissions,transaction} from '@waitron-cloud/registration';
import type {Pool,PoolClient} from 'pg';
import {boundedResolveCname,boundedResolveTxt,type ResolveCname,type ResolveTxt} from './dns-lookup.ts';
import {isHostname,isUuid} from './manifest.ts';
import {mailKeyTxt,type createRoute53MailDnsProvider} from './route53-dns.ts';
import type {createSesSigningProvider} from './ses-signing.ts';
import {hasActiveVenueMailInstallation,venueMailAlias,venueMailDomain,venueMailTarget} from './venue-mail-records.ts';

type Choice={organisation:string;address:string;domain:string;selector:string};
interface Claim {
 organisation_id:string;domain:string;selector:string;public_key:string;
 ses_region:string;zone_id:string;dns_suffix:string;tag:string;
}
export interface VenueMailSigningConfig {suffix:string;zoneId:string;region:string;testDomains:readonly string[]}
interface SigningOptions {
 config:VenueMailSigningConfig;
 ses:Omit<ReturnType<typeof createSesSigningProvider>,'close'>;
 dns:Omit<ReturnType<typeof createRoute53MailDnsProvider>,'close'>;
 resolveCname?:ResolveCname;
 resolveTxt?:ResolveTxt;
}

async function readChoice(client:PoolClient,venueId:string,config:VenueMailSigningConfig):Promise<Choice|undefined>{
 const {rowCount}=await client.query("SELECT 1 FROM venues WHERE id=$1 AND environment='test'",[venueId]);
 if(!rowCount)return;
 const permission=await readVenuePermissions(client,venueId,'test-venue-levels');
 if(permission.level!=='connected'&&permission.level!=='hosted')return;
 const row=(await client.query<{waitron_mail_from:string|null;waitron_mail_dns_token:string|null}>(
  'SELECT waitron_mail_from,waitron_mail_dns_token FROM venues WHERE id=$1',[venueId],
 )).rows[0]!;
 const address=row.waitron_mail_from,selector=row.waitron_mail_dns_token;
 if(!address||!isUuid(selector))return;
 const domain=venueMailDomain(address)?.toLowerCase();
 if(!isHostname(domain)||!config.testDomains.includes(domain)||!await hasActiveVenueMailInstallation(client,venueId))return;
 return {organisation:permission.organisationId,address,domain,selector};
}

const ownsChoice=(claim:Claim,choice:Choice)=>claim.organisation_id===choice.organisation&&
 claim.domain===choice.domain&&claim.selector===choice.selector;
const sameChoice=(before:Choice,after:Choice|undefined)=>after?.address===before.address&&
 after.organisation===before.organisation&&after.selector===before.selector;

async function saveClaim(client:PoolClient,venueId:string,choice:Choice,config:VenueMailSigningConfig,
 publicKey:string,tag:string):Promise<Claim|undefined>{
 if(!sameChoice(choice,await readChoice(client,venueId,config)))return;
 return (await client.query<Claim>(`INSERT INTO venue_mail_signing
  (venue_id,organisation_id,domain,selector,public_key,ses_region,zone_id,dns_suffix,tag)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`,
 [venueId,choice.organisation,choice.domain,choice.selector,publicKey,config.region,config.zoneId,config.suffix,tag])).rows[0];
}

async function releaseClaim(pool:Pool,venueId:string,tag:string){
 return (await pool.query('DELETE FROM venue_mail_signing WHERE venue_id=$1 AND tag=$2',[venueId,tag])).rowCount;
}

async function confirmRemoval(remove:()=>Promise<void>,isAbsent:()=>Promise<boolean>){
 try{await remove();}
 catch(error){
  if(!await isAbsent())throw error;
  return true;
 }
 return isAbsent();
}

async function retireClaim(pool:Pool,venueId:string,claim:Claim,{ses,dns}:SigningOptions){
 await dns.checkZone();
 const target=venueMailTarget(claim.selector,claim.dns_suffix);
 const readIdentity=()=>ses.read(claim.domain),readRecord=()=>dns.read(target,claim.public_key);
 const identity=await readIdentity(),record=await readRecord();
 // An absent record cannot settle a create that may still be accepted.
 if(!identity&&record==='absent'){
  console.error(`Venue ${venueId} stopped signing cleanup before releasing its claim because neither provider record is visible.`);
  return 'held';
 }
 if(identity){
  if(identity.tag!==claim.tag)return 'held';
  const absent=await confirmRemoval(()=>ses.remove(claim.domain),async()=>await readIdentity()===null);
  if(!absent)return 'held';
 }
 const txtAbsent=async()=>await readRecord()==='absent';
 const absent=record==='matching'?
  await confirmRemoval(()=>dns.remove(target,claim.public_key),txtAbsent):await txtAbsent();
 if(!absent)return 'held';
 return await releaseClaim(pool,venueId,claim.tag)?'retired':'held';
}

export async function runVenueMailSigning(pool:Pool,venueId:string,options:SigningOptions){
 const {config,ses,dns,resolveCname,resolveTxt}=options;
 if(!isUuid(venueId))throw new Error('invalid_venue_mail_venue');
 const current=()=>transaction(pool,client=>readChoice(client,venueId,config));
 const choice=await current();
 let claim=(await pool.query<Claim>('SELECT * FROM venue_mail_signing WHERE venue_id=$1',[venueId])).rows[0];
 if(claim){
  if(claim.ses_region!==config.region||claim.zone_id!==config.zoneId||claim.dns_suffix!==config.suffix||
    !config.testDomains.includes(claim.domain))return 'held';
  if(!choice||!ownsChoice(claim,choice))return retireClaim(pool,venueId,claim,options);
 }
 if(!choice)return 'ineligible';
 const alias=venueMailAlias(choice.domain,choice.selector,config.suffix);
 const hasAlias=async()=>{
  const targets=await boundedResolveCname(alias.name,resolveCname).catch(()=>[]);
  return targets.length===1&&targets[0]!.toLowerCase().replace(/\.$/,'')===alias.value;
 };
 if(!await hasAlias())return 'awaiting_dns';
 await dns.checkZone();
 let identity=await ses.read(choice.domain);
 let record=claim?await dns.read(alias.value,claim.public_key):undefined;
 if(!claim){
  if(identity)return 'held';
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,
   publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'der'}});
  const publicText=publicKey.toString('base64');
  if(await dns.read(alias.value,publicText)!=='absent')return 'held';
  const tag=randomUUID();
  claim=await transaction(pool,client=>saveClaim(client,venueId,choice,config,publicText,tag));
  if(!claim)return 'held';
  if(await ses.create(claim.domain,claim.selector,claim.tag,privateKey.toString('base64'))==='refused'){
   await releaseClaim(pool,venueId,claim.tag);
   throw new Error('ses_signing_create_refused');
  }
  identity=await ses.read(claim.domain);
  record=await dns.read(alias.value,claim.public_key);
 }
 if(!identity||identity.tag!==claim.tag||!identity.external||
   identity.selectors.length!==1||identity.selectors[0]!==claim.selector||record==='different')return 'held';
 if(record==='absent'){
  if(!sameChoice(choice,await current())||!await hasAlias())return 'held';
  await dns.create(alias.value,claim.public_key);
 }
 const records=await boundedResolveTxt(alias.value,resolveTxt).catch(()=>[]);
 if(!identity.verified||records.length!==1||records[0]!.join('')!==mailKeyTxt(claim.public_key))return 'pending';
 if(!await hasAlias()||!sameChoice(choice,await current()))return 'held';
 return 'verified';
}
