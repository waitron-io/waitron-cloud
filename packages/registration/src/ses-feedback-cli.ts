import {Pool} from 'pg';
import {openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spainCountryPolicy} from './country-policy.ts';
import {validateSesFeedbackConfig,type SesFeedbackPolicy} from './ses-feedback-config.ts';
import {RelayKeys,type RelayKeyConfig} from './relay-payload.ts';
import {createSesFeedbackQueue} from './ses-feedback-queue.ts';
import {runSesFeedbackConsumer} from './ses-feedback-service.ts';

function readBoundedJson(path:string):unknown {
 let fd:number|undefined;
 try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>65536)throw Error();
  const bytes=Buffer.alloc(65537),size=readSync(fd,bytes,0,bytes.length,0);if(size>65536)throw Error();
  return JSON.parse(bytes.subarray(0,size).toString('utf8'));
 }finally{if(fd!==undefined)closeSync(fd);}
}

/** The deployment supplies data; only the compiled policy can qualify it. */
export function configuredSesFeedbackConsumer(env:NodeJS.ProcessEnv=process.env,policy:SesFeedbackPolicy=spainCountryPolicy) {
 try{
  if(env.CLOUD_SES_FEEDBACK_CONSUMER!=='enabled'||!env.DATABASE_URL||!env.CLOUD_SES_FEEDBACK_CONFIG_FILE
   ||!env.CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID||!env.CLOUD_MAIL_RECIPIENT_KEYS)throw Error();
  const url=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(url.protocol))throw Error();
  const config=validateSesFeedbackConfig(policy,readBoundedJson(env.CLOUD_SES_FEEDBACK_CONFIG_FILE));
  const recipientKeys:RelayKeyConfig={activeKeyId:env.CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID,keys:JSON.parse(env.CLOUD_MAIL_RECIPIENT_KEYS)};
  new RelayKeys(recipientKeys);
  return {config,recipientKeys,databaseUrl:env.DATABASE_URL};
 }catch{throw Error('ses_feedback_configuration_failed');}
}

export function createSesFeedbackPool(databaseUrl:string):Pool {
 return new Pool({connectionString:databaseUrl,max:3,connectionTimeoutMillis:5000,statement_timeout:5000});
}

async function main() {
 const stop=new AbortController();let deadline:ReturnType<typeof setTimeout>|undefined;
 const shutdown=()=>{
  if(stop.signal.aborted)return;
  // Driver handles can outlive a settled request promise.
  deadline=setTimeout(()=>{console.error('SES feedback shutdown failed');process.exit(1);},20000);
  deadline.unref();stop.abort();
 };
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 let pool:Pool|undefined,queue:ReturnType<typeof createSesFeedbackQueue>|undefined,ownedByService=false;
 try{
  const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--once'))throw Error();
  const settings=configuredSesFeedbackConsumer();pool=createSesFeedbackPool(settings.databaseUrl);
  queue=createSesFeedbackQueue(settings.config);ownedByService=true;
  await runSesFeedbackConsumer({...settings,pool,queue,signal:stop.signal,once:args[0]==='--once',
   sample:()=>process.env.CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE?readBoundedJson(process.env.CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE):undefined,
   onStatus:status=>console.log(JSON.stringify(status))});
 }catch{
  console.error('SES feedback consumer failed; check configuration and service health');process.exitCode=1;
 }finally{
  if(!ownedByService){queue?.close();await pool?.end();}
  // An unreferenced deadline permits natural drain but still bounds retained handles.
  if(!stop.signal.aborted)clearTimeout(deadline);
  process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
 }
 // A failed bounded cleanup must not retain a process through a broken driver.
 if(process.exitCode===1)process.exit(1);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
