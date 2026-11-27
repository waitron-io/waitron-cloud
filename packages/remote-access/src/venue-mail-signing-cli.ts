import {parsePlanMode} from '@waitron-cloud/registration';
import {Pool} from 'pg';
import {isHostname,isUuid} from './manifest.ts';
import {createRoute53MailDnsProvider} from './route53-dns.ts';
import {createSesSigningProvider} from './ses-signing.ts';
import {runVenueMailSigning} from './venue-mail-signing.ts';

let pool:Pool|undefined,ses:ReturnType<typeof createSesSigningProvider>|undefined,
 dns:ReturnType<typeof createRoute53MailDnsProvider>|undefined;
try{
 const env=process.env,[venueId,...extra]=process.argv.slice(2);
 const suffix=env.CLOUD_VENUE_MAIL_DNS_SUFFIX,zoneId=env.CLOUD_VENUE_MAIL_DNS_ZONE_ID,region=env.CLOUD_VENUE_MAIL_SES_REGION;
 const testDomains=(env.CLOUD_VENUE_MAIL_TEST_DOMAINS??'').split(',').map(domain=>domain.trim().toLowerCase());
 if(parsePlanMode(env.CLOUD_TEST_SERVICE_PLANS,env.CLOUD_VENUE_SERVICE_LEVELS)!=='test-venue-levels'){
  console.error('Enable test venue levels before running venue-mail:signing.');
  process.exitCode=1;
 }else if(!isUuid(venueId)||extra.length||!env.DATABASE_URL||!isHostname(suffix)||suffix.length>211
   ||!zoneId||!/^Z[A-Z0-9]+$/.test(zoneId)||!region||!/^[a-z]{2}(?:-[a-z]+)+-[1-9][0-9]*$/.test(region)
   ||!testDomains.every(isHostname)){
  console.error('Supply one test venue ID, a database URL and the venue mail signing settings.');
  process.exitCode=1;
 }else{
  pool=new Pool({connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
  ses=createSesSigningProvider({region});
  dns=createRoute53MailDnsProvider({zoneId,suffix});
  console.log(await runVenueMailSigning(pool,venueId,{config:{suffix,zoneId,region,testDomains},ses,dns}));
 }
}catch{
 console.error('Venue signing failed. Check the test configuration and rerun to read provider state.');
 process.exitCode=1;
}finally{
 ses?.close();
 dns?.close();
 await pool?.end();
}
