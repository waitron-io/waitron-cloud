import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {EmailOutbox,EmailWorker} from '../../packages/registration/src/email-outbox.ts';
import {createLeaseIssuer} from '../../packages/registration/src/installation-proof.ts';
import {runWorkerLoop} from '../../packages/registration/src/worker-loop.ts';
import {createTestCaptureMailer} from './capture-mailer.mjs';
import {loadTestSesRuntime,loadTestVenueSesRuntime} from './ses-runtime.mjs';
import {checkConsumerDatabase,loadRuntime} from '../local-stack/runtime.mjs';
import {testRuntimeEnvironment} from './runtime.mjs';
import {parsePlanMode} from '../../packages/registration/src/organisation-plans.ts';
import {readVenueMailSigningConfig} from '../../packages/remote-access/src/venue-mail-signing-config.ts';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
export async function runTestEmailQueues({account,relay,signing,signal,once=false}){
 const runSigning=async currentSignal=>{
  try{if(!currentSignal?.aborted)await signing(currentSignal);}
  catch{console.error('Test venue signing pass failed; check private configuration and schema');}
  return false;
 };
 if(once){
  const runs=[Promise.resolve().then(()=>account.runOnce())];
  if(relay)runs.push(Promise.resolve().then(()=>relay.runOnce()));
  if(signing)runs.push(runSigning(signal));
  const results=await Promise.allSettled(runs);
  const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
  return results.some(result=>result.value);
 }
 const stop=new AbortController(),combined=AbortSignal.any([signal,stop.signal]);
 const loops=[runWorkerLoop({signal:combined,concurrency:relay?3:4,scheduleIntervalMs:60000,pollIntervalMs:1000,runOnce:()=>account.runOnce()}).finally(()=>stop.abort())];
 if(relay)loops.push(runWorkerLoop({signal:combined,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:1000,runOnce:()=>relay.runOnce(),
  onError:()=>console.error('Test relay worker failed; check private configuration and schema')}).finally(()=>stop.abort()));
 if(signing)loops.push(runWorkerLoop({signal:combined,concurrency:1,scheduleIntervalMs:60000,pollIntervalMs:60000,
  runOnce:runSigning}).finally(()=>stop.abort()));
 const results=await Promise.allSettled(loops),failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
}
export function createTestAccountWorker(pool,outbox,captureMailer,pilot){
 const options=pilot?{ses:pilot.ses,sesRecipient:{email:pilot.email,captureMailer}}:undefined;
 return new EmailWorker(pool,outbox,pilot?.mailer??captureMailer,options);
}
export async function runTestEmailWorker({directory='/run/local-stack',root='/app',signal,once=false}={}){
 const pilot=loadTestSesRuntime(process.env);
 const venueSes=loadTestVenueSesRuntime(process.env);
 const config=await loadRuntime(directory),environment=testRuntimeEnvironment('email',config,process.env);
 await checkConsumerDatabase(environment.DATABASE_URL,root);
 const pool=new Pool({connectionString:environment.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});
 const stop=new AbortController(),abort=()=>stop.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();pool.on('error',abort);
 let ses,dns;
 try{
  const outbox=new EmailOutbox({activeKeyId:config.email.activeKeyId,keys:config.email.keys});
  const captureMailer=createTestCaptureMailer({origin:environment.CLOUD_PORTAL_ORIGIN,port:1025},process.env.TEST_CLOUD_ORIGIN??'https://waitron.local:3000');
  const worker=createTestAccountWorker(pool,outbox,captureMailer,pilot);
  const mode=parsePlanMode(environment.CLOUD_TEST_SERVICE_PLANS,environment.CLOUD_VENUE_SERVICE_LEVELS);let relayRuntime;
  if(venueSes&&(mode!=='test-venue-levels'||environment.CLOUD_TEST_VENUE_MAIL_SIGNING==='1'))throw Error('test_cloud.ses_configuration');
  const relay=mode==='test-venue-levels'?{async runOnce(){
   const {openTestRelayRuntime}=await import('./relay-runtime.mjs');
   relayRuntime??=await openTestRelayRuntime({pool,directory,issuer:createLeaseIssuer(config.installation.issuerKey),origin:environment.CLOUD_PORTAL_ORIGIN,mode,venueSes});
   return relayRuntime.worker.runOnce();
  }}:undefined;
  let signing;
  if(environment.CLOUD_TEST_VENUE_MAIL_SIGNING==='1'){
   const signingConfig=readVenueMailSigningConfig(environment,true);
   const [{createSesSigningProvider},{createRoute53MailDnsProvider},{refreshVenueMailSignings}]=await Promise.all([
    import('../../packages/remote-access/src/ses-signing.ts'),import('../../packages/remote-access/src/route53-dns.ts'),
    import('../../packages/remote-access/src/venue-mail-signing.ts')]);
   ses=createSesSigningProvider({region:signingConfig.region});
   dns=createRoute53MailDnsProvider({zoneId:signingConfig.zoneId,suffix:signingConfig.suffix});
   signing=signal=>refreshVenueMailSignings(pool,{config:signingConfig,ses,dns,outbox,setupSavedChoices:true},signal);
  }
  return await runTestEmailQueues({account:worker,relay,signing,signal:stop.signal,once});
 }finally{
  signal?.removeEventListener('abort',abort);ses?.close();dns?.close();await pool.end();
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 try{if(process.argv.length!==2)throw Error();await runTestEmailWorker({directory:process.env.LOCAL_STACK_CONFIG_DIR,signal:stop.signal});}
 catch(error){
  console.error(error?.message==='test_cloud.ses_configuration'
   ?'Test email worker refused SES settings':'Test capture worker failed; check private configuration and schema');
  process.exitCode=1;
 }
 finally{process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);}
}
