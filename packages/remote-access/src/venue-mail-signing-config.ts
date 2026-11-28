import {isHostname} from './manifest.ts';
import type {VenueMailSigningConfig} from './venue-mail-signing.ts';

export function readVenueMailSigningConfig(env:NodeJS.ProcessEnv,requireProviderAccount=false):VenueMailSigningConfig|undefined{
 const suffix=env.CLOUD_VENUE_MAIL_DNS_SUFFIX,zoneId=env.CLOUD_VENUE_MAIL_DNS_ZONE_ID,region=env.CLOUD_VENUE_MAIL_SES_REGION;
 const providerAccountId=env.CLOUD_VENUE_MAIL_SES_ACCOUNT_ID;
 const testDomains=(env.CLOUD_VENUE_MAIL_TEST_DOMAINS??'').split(',').map(domain=>domain.trim().toLowerCase());
 if(!isHostname(suffix)||suffix.length>211||!zoneId||!/^Z[A-Z0-9]+$/.test(zoneId)||
  !region||!/^[a-z]{2}(?:-[a-z]+)+-[1-9][0-9]*$/.test(region)||
  ((requireProviderAccount||providerAccountId!==undefined)&&!/^[0-9]{12}$/.test(providerAccountId??''))||
  !testDomains.every(isHostname))return;
 return {suffix,zoneId,region,testDomains,providerAccountId};
}
