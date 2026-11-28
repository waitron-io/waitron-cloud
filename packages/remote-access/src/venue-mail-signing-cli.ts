import {EmailOutbox,parsePlanMode,runWorkerLoop} from '@waitron-cloud/registration';
import {Pool} from 'pg';
import {isUuid} from './manifest.ts';
import {createRoute53MailDnsProvider} from './route53-dns.ts';
import {createSesSigningProvider} from './ses-signing.ts';
import {refreshVenueMailSignings,runVenueMailSigning} from './venue-mail-signing.ts';
import {readVenueMailSigningConfig} from './venue-mail-signing-config.ts';

let pool:Pool|undefined,ses:ReturnType<typeof createSesSigningProvider>|undefined,
 dns:ReturnType<typeof createRoute53MailDnsProvider>|undefined;
const stop=new AbortController(),shutdown=()=>stop.abort();
try{
 const env=process.env,[venueId,...extra]=process.argv.slice(2);
 const watch=venueId==='--watch',config=readVenueMailSigningConfig(env,watch);
 if(parsePlanMode(env.CLOUD_TEST_SERVICE_PLANS,env.CLOUD_VENUE_SERVICE_LEVELS)!=='test-venue-levels'){
  console.error('Enable test venue levels before running venue-mail:signing.');
  process.exitCode=1;
 }else if((!watch&&!isUuid(venueId))||extra.length||!env.DATABASE_URL||!config){
  console.error('Supply one test venue ID or --watch, a database URL and the venue mail signing settings.');
  process.exitCode=1;
 }else{
  const outbox=env.CLOUD_EMAIL_ACTIVE_KEY_ID&&env.CLOUD_EMAIL_KEYS
   ?new EmailOutbox({activeKeyId:env.CLOUD_EMAIL_ACTIVE_KEY_ID,keys:JSON.parse(env.CLOUD_EMAIL_KEYS)}):undefined;
  pool=new Pool({connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
  ses=createSesSigningProvider({region:config.region});
  dns=createRoute53MailDnsProvider({zoneId:config.zoneId,suffix:config.suffix});
  const options={config,ses,dns,outbox};
  if(watch){
   if(!outbox)throw Error('venue_signing_mail_keys_required');
   const interval=15*60*1000;
   pool.on('error',()=>console.error('Venue signing database connection failed; retrying.'));
   process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
   await runWorkerLoop({signal:stop.signal,concurrency:1,scheduleIntervalMs:interval,pollIntervalMs:interval,
    async runOnce(signal){await refreshVenueMailSignings(pool!,options,signal);return false;},
    onError(){console.error('Venue signing pass failed; retrying.');}});
  }else{
   const result=await runVenueMailSigning(pool,venueId!,options);
   console.log(result);
   if(result==='held')console.error('Check the configured provider scope, the saved SES identity tag and the exact signing TXT record before retrying.');
  }
 }
}catch(error){
 console.error(error instanceof Error&&error.message==='venue_signing_mail_keys_required'
  ?'Set CLOUD_EMAIL_ACTIVE_KEY_ID and CLOUD_EMAIL_KEYS before verifying a venue sender.'
  :'Venue signing failed. Check the test configuration and rerun to read provider state.');
 process.exitCode=1;
}finally{
 process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
 ses?.close();
 dns?.close();
 await pool?.end();
}
