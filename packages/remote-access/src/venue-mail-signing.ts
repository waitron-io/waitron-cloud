import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readVenuePermissions,transaction,type EmailOutbox} from '@waitron-cloud/registration';
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
export interface VenueMailSigningConfig {suffix:string;zoneId:string;region:string;testDomains:readonly string[];providerAccountId?:string}
interface SigningOptions {
 config:VenueMailSigningConfig;
 readOnly?:boolean;
 ses:Omit<ReturnType<typeof createSesSigningProvider>,'close'>;
 dns:Omit<ReturnType<typeof createRoute53MailDnsProvider>,'close'>;
 outbox?:EmailOutbox;
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

async function publicRecords<T>(read:Promise<T[]>):Promise<T[]|undefined>{
 try{return await read;}
 catch(error){
  if(['ENOTFOUND','ENODATA'].includes((error as NodeJS.ErrnoException)?.code??''))return [];
 }
}

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
 await pool.query(`UPDATE venue_mail_signing SET verified=false,verified_at=NULL,ses_identity_arn=NULL
  WHERE venue_id=$1 AND tag=$2`,[venueId,claim.tag]);
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
 const {config,ses,dns,outbox,resolveCname,resolveTxt,readOnly}=options;
 if(!isUuid(venueId))throw new Error('invalid_venue_mail_venue');
 const current=()=>transaction(pool,client=>readChoice(client,venueId,config));
 const choice=await current();
 let claim=(await pool.query<Claim>('SELECT * FROM venue_mail_signing WHERE venue_id=$1',[venueId])).rows[0];
 if(claim){
  if(claim.ses_region!==config.region||claim.zone_id!==config.zoneId||claim.dns_suffix!==config.suffix||
    !config.testDomains.includes(claim.domain))return 'held';
  if(!choice||!ownsChoice(claim,choice))return readOnly?'held':retireClaim(pool,venueId,claim,options);
 }
 if(!choice||(readOnly&&!claim))return 'ineligible';
 if(!outbox)throw new Error('venue_signing_mail_keys_required');
 const alias=venueMailAlias(choice.domain,choice.selector,config.suffix);
 const hasAlias=async()=>{
  const targets=await publicRecords(boundedResolveCname(alias.name,resolveCname));
  return targets&&targets.length===1&&targets[0]!.toLowerCase().replace(/\.$/,'')===alias.value;
 };
 const saveResult=async(verified:boolean)=>{
  const tag=claim?.tag;
  if(!tag)return false;
  const previous=await transaction(pool,async client=>{
   if(!sameChoice(choice,await readChoice(client,venueId,config)))return;
   const saved=(await client.query<{verified:boolean}>(`SELECT verified FROM venue_mail_signing
    WHERE venue_id=$1 AND tag=$2 FOR UPDATE`,[venueId,tag])).rows[0];
   if(!saved)return;
   const arn=verified&&config.providerAccountId?`arn:aws:ses:${config.region}:${config.providerAccountId}:identity/${choice.domain}`:null;
   // Renew SES evidence only when the check names the provider account.
   await client.query(`UPDATE venue_mail_signing SET verified=$2,
    verified_at=CASE WHEN NOT $2 THEN NULL WHEN $3::text IS NULL THEN verified_at ELSE clock_timestamp() END,
    ses_identity_arn=CASE WHEN $2 THEN COALESCE($3,ses_identity_arn) END WHERE venue_id=$1`,[venueId,verified,arn]);
   if(saved.verified&&!verified)await outbox.enqueueVenueSigningLoss(client,venueId,choice.organisation,choice.domain);
   return saved;
  });
  if(previous?.verified&&!verified)console.error(`Venue ${venueId} lost signing verification. Local staff mail uses the Waitron sender.`);
  return !!previous;
 };
 const aliasMatches=await hasAlias();
 if(aliasMatches!==true){
  if(aliasMatches===false)await saveResult(false);
  return 'awaiting_dns';
 }
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
 if(!identity||identity.lost||identity.tag!==claim.tag||!identity.external||
   identity.selectors.length!==1||identity.selectors[0]!==claim.selector||record==='different'){
  await saveResult(false);
  if(identity?.lost&&identity.tag===claim.tag)console.error('SES reports signing failed. Clear the sender and rerun this command to retire its signing setup before saving it again.');
  return 'held';
 }
 if(record==='absent'){
  if(readOnly){await saveResult(false);return 'pending';}
  if(!sameChoice(choice,await current()))return 'held';
  const stillMatches=await hasAlias();
  if(stillMatches!==true){if(stillMatches===false)await saveResult(false);return 'held';}
  await dns.create(alias.value,claim.public_key);
 }
 const records=await publicRecords(boundedResolveTxt(alias.value,resolveTxt));
 if(records&&(records.length!==1||records[0]!.join('')!==mailKeyTxt(claim.public_key))){
  await saveResult(false);
  return 'pending';
 }
 if(!identity.verified||!records)return 'pending';
 const stillMatches=await hasAlias();
 if(stillMatches===false)await saveResult(false);
 return stillMatches===true&&await saveResult(true)?'verified':'held';
}

export async function listVenueMailSigningCandidates(pool:Pool,testDomains:readonly string[]=[]){
 const {rows}=await pool.query<{venue_id:string}>(`SELECT venue_id FROM venue_mail_signing
  UNION SELECT id FROM venues WHERE environment='test' AND waitron_mail_dns_token IS NOT NULL
  AND lower(split_part(waitron_mail_from,'@',2))=ANY($1::text[]) ORDER BY venue_id`,[testDomains]);
 return rows.map(row=>row.venue_id);
}

export async function refreshVenueMailSignings(pool:Pool,options:SigningOptions & {setupSavedChoices?:boolean},signal?:AbortSignal){
 const {setupSavedChoices,config}=options;
 const venues=await listVenueMailSigningCandidates(pool,setupSavedChoices?config.testDomains:[]);
 for(const venueId of venues){
  if(signal?.aborted)break;
  try{
   const result=await runVenueMailSigning(pool,venueId,{...options,readOnly:!setupSavedChoices});
   if(result==='held')console.error(`Venue signing check held. Run venue-mail:signing ${venueId} and check the provider settings.`);
  }
  catch{console.error(`Venue ${venueId} signing check failed. The last confirmed result is retained until expiry.`);}
 }
}
