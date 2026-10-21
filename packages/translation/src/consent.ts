import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {TranslationError,type TranslationErrorCode} from './errors.ts';
function fail(code:TranslationErrorCode):never{throw new TranslationError(code);}
export const translationConsentVersion='providers-2026-10-14';
export const translationProviders=['openai','anthropic','google'] as const;
export interface ConsentView {venueId:string;consented:boolean;consentedAt:string|null}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const current=`SELECT c.venue_id,c.consented_at FROM translation_consents c
 JOIN venues v ON v.id=c.venue_id AND v.organisation_id=c.organisation_id
 JOIN organisation_memberships m ON m.account_id=c.account_id AND m.organisation_id=v.organisation_id AND m.is_owner
 JOIN cloud_accounts a ON a.id=c.account_id AND a.disabled_at IS NULL
 JOIN cloud_credentials k ON k.account_id=c.account_id AND k.email_verified_at IS NOT NULL
 WHERE c.venue_id=ANY($1::uuid[]) AND c.withdrawn_at IS NULL AND c.consent_version=$2`;
export async function hasConsent(client:PoolClient,venueId:string):Promise<boolean>{
 return !!(await client.query(current,[[venueId],translationConsentVersion])).rowCount;
}
async function view(client:PoolClient,venueId:string):Promise<ConsentView>{
 const row=(await client.query<{consented_at:Date}>(current,[[venueId],translationConsentVersion])).rows[0];
 return {venueId,consented:!!row,consentedAt:row?row.consented_at.toISOString():null};
}
async function ownedVenue(client:PoolClient,accountId:string,venueId:string):Promise<{organisation_id:string}>{
 if(!uuid.test(venueId))fail('invalid_request');
 // Match account authorization's lock order before taking membership and venue locks.
 if(!(await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR SHARE',[accountId])).rowCount)fail('forbidden');
 if(!(await client.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 AND email_verified_at IS NOT NULL FOR SHARE',[accountId])).rowCount)fail('forbidden');
 const candidate=(await client.query<{organisation_id:string}>('SELECT organisation_id FROM venues WHERE id=$1',[venueId])).rows[0];
 if(!candidate)fail('forbidden');
 if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND account_id=$2 AND is_owner FOR SHARE',[candidate.organisation_id,accountId])).rowCount)fail('forbidden');
 const venue=(await client.query<{organisation_id:string}>('SELECT organisation_id FROM venues WHERE id=$1 AND organisation_id=$2 FOR SHARE',[venueId,candidate.organisation_id])).rows[0];
 return venue??fail('forbidden');
}
export async function listConsents(client:PoolClient,accountId:string):Promise<ConsentView[]>{
 const venues=(await client.query<{id:string}>(`SELECT v.id FROM venues v JOIN organisation_memberships m ON m.organisation_id=v.organisation_id
  JOIN cloud_accounts a ON a.id=m.account_id AND a.disabled_at IS NULL
  JOIN cloud_credentials k ON k.account_id=m.account_id AND k.email_verified_at IS NOT NULL
  WHERE m.account_id=$1 AND m.is_owner ORDER BY v.id`,[accountId])).rows;
 if(!venues.length)return [];
 const consents=(await client.query<{venue_id:string;consented_at:Date}>(current,[venues.map(venue=>venue.id),translationConsentVersion])).rows;
 const byVenue=new Map(consents.map(row=>[row.venue_id,row.consented_at]));
 return venues.map(venue=>{
  const consentedAt=byVenue.get(venue.id);
  return {venueId:venue.id,consented:!!consentedAt,consentedAt:consentedAt?.toISOString()??null};
 });
}
export async function agreeConsent(client:PoolClient,accountId:string,input:{venueId:string;consentVersion:string}):Promise<ConsentView>{
 if(input.consentVersion!==translationConsentVersion)fail('invalid_request');
 const venue=await ownedVenue(client,accountId,input.venueId);
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[input.venueId]);
 if(!await hasConsent(client,input.venueId)){
  await client.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1 AND withdrawn_at IS NULL',[input.venueId]);
  await client.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers) VALUES($1,$2,$3,$4,$5,$6)`,
   [randomUUID(),input.venueId,venue.organisation_id,accountId,translationConsentVersion,[...translationProviders]]);
 }
 return view(client,input.venueId);
}
export async function withdrawConsent(client:PoolClient,accountId:string,input:{venueId:string}):Promise<ConsentView>{
 await ownedVenue(client,accountId,input.venueId);
 // Agreement can replace a stale row; serialize withdrawal before its UPDATE takes a snapshot.
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('translation-consent:'||$1,0))",[input.venueId]);
 await client.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE venue_id=$1 AND withdrawn_at IS NULL',[input.venueId]);
 return view(client,input.venueId);
}
