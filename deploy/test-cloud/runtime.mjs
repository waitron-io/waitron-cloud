import {spawn} from 'node:child_process';
import {lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadRuntime,runtimeEnvironment,checkConsumerDatabase,canonicalHttpsOrigin} from '../local-stack/runtime.mjs';
import {cloudActionDemoEnabled} from '../../packages/registration/src/cloud-action-worker.ts';
import {parsePlanMode} from '../../packages/registration/src/organisation-plans.ts';
import {allowanceOptionsFromEnv} from '../../packages/registration/src/billing-allowance-rules.ts';
const commands={'action-demo':'packages/registration/src/cloud-action-cli.ts',migrate:'packages/registration/src/migrate-cli.ts',account:'deploy/test-cloud/account-worker.mjs',storage:'deploy/test-cloud/storage-worker.mjs',email:'deploy/test-cloud/email-worker.mjs',monitor:'packages/registration/src/monitor-cli.ts',usage:'packages/registration/src/usage-reconcile-cli.ts',probe:'packages/remote-access/src/probe-cli.ts',backup:'deploy/test-cloud/backup-worker.mjs',gateway:'packages/remote-access/src/gateway-cli.ts',manifest:'deploy/test-cloud/remote-worker.mjs',reconcile:'packages/remote-access/src/reconciler-cli.ts',translation:'packages/translation/src/worker-cli.ts'};
export function testRuntimeCommand(role){if(!Object.hasOwn(commands,role))throw new Error('test_cloud.role_invalid');return commands[role];}
export function testRuntimeEnvironment(role,config,environment={}){
 testRuntimeCommand(role);
 const demo=cloudActionDemoEnabled(environment);
 if(role==='action-demo'&&!demo)throw Error('cloud_action_demo_disabled');
 const flag=environment.CLOUD_TEST_SERVICE_PLANS??'0',venueFlag=environment.CLOUD_VENUE_SERVICE_LEVELS;
 let mode;try{mode=parsePlanMode(flag,venueFlag);}catch{throw new Error('test_cloud.plan_mode');}
 let allowances;try{allowances=allowanceOptionsFromEnv(environment,mode);}catch{throw new Error('test_cloud.allowance_mode');}
 const enabled=mode!=='existing';
 const result=runtimeEnvironment(role==='action-demo'?'migrate':role==='storage'||role==='manifest'&&enabled?'reconcile':role,config,role==='account'?{CLOUD_FACTOR_POLICY:environment.CLOUD_FACTOR_POLICY,CLOUD_SIGNUP_LIMITS:environment.CLOUD_SIGNUP_LIMITS,CLOUD_TURNSTILE_SITE_KEY:environment.CLOUD_TURNSTILE_SITE_KEY,CLOUD_TURNSTILE_SECRET_KEY:environment.CLOUD_TURNSTILE_SECRET_KEY,...(demo?{CLOUD_OPERATOR_ACCOUNT_ID:environment.CLOUD_OPERATOR_ACCOUNT_ID}:{})}:{},canonicalHttpsOrigin(environment.TEST_CLOUD_ORIGIN??'https://waitron.local:3000'));result.CLOUD_TEST_SERVICE_PLANS=flag;
 if(environment.TEST_CLOUD_ORIGIN!==undefined)result.TEST_CLOUD_ORIGIN=environment.TEST_CLOUD_ORIGIN;
 if(role==='manifest')for(const name of ['TEST_CLOUD_PUBLIC_REMOTE','TEST_CLOUD_ACME_DIRECTORY','TEST_CLOUD_CHALLENGE_DIR'])if(environment[name]!==undefined)result[name]=environment[name];
 if(venueFlag!==undefined)result.CLOUD_VENUE_SERVICE_LEVELS=venueFlag;
 if(allowances&&['account','translation'].includes(role)){result.CLOUD_TEST_ALLOWANCES='1';result.CLOUD_ALLOWANCE_CALENDAR=allowances.calendar;}
 if(['account','storage','backup'].includes(role))result.NODE_EXTRA_CA_CERTS='/run/local-stack/lan/ca.pem';
 if(['account','action-demo'].includes(role)&&demo){result.CLOUD_ACTION_DEMO='1';result.CLOUD_ACTION_DEMO_DIR=environment.CLOUD_ACTION_DEMO_DIR??'/run/cloud-action-demo';}
 if(role==='account'&&demo&&environment.TEST_CLOUD_AMAZON==='1')result.TEST_CLOUD_AMAZON='1';
 if(role==='account'){delete result.CLOUD_LOCAL_REQUEST_METRICS;result.CLOUD_TRANSLATION='0';result.CLOUD_HTTP_TRUSTED_PROXY_IPS=environment.CLOUD_HTTP_TRUSTED_PROXY_IPS??'10.79.0.2';if(enabled)result.CLOUD_STAFF_CERTIFICATES='1';}
 if(role==='account'&&enabled&&environment.CLOUD_EXIT_STAGE_ROOT!==undefined){
  if(environment.NODE_ENV==='production'||environment.TEST_CLOUD_AMAZON==='1'||environment.CLOUD_EXIT_STAGE_ROOT!=='/run/backup-stage')throw Error('test_cloud.exit_stage');
  result.CLOUD_EXIT_STAGE_ROOT=environment.CLOUD_EXIT_STAGE_ROOT;
 }
 if(role==='account'&&environment.NODE_ENV!=='production'&&environment.CLOUD_ADDRESS_LOOKUP_SETTINGS&&environment.GOOGLE_MAPS_SERVER_KEY){
  result.CLOUD_ADDRESS_LOOKUP_SETTINGS=environment.CLOUD_ADDRESS_LOOKUP_SETTINGS;
  result.GOOGLE_MAPS_SERVER_KEY=environment.GOOGLE_MAPS_SERVER_KEY;
 }
 const publicGatewayIssuer=environment.TEST_CLOUD_AMAZON==='1'&&environment.TEST_CLOUD_PUBLIC_REMOTE==='1'&&
  environment.TEST_CLOUD_ACME_DIRECTORY==='https://acme-v02.api.letsencrypt.org/directory';
 // An explicit CA replaces Node's public roots for the staff HTTPS request.
 if(role==='gateway'&&!publicGatewayIssuer)result.GATEWAY_UPSTREAM_CA='/run/local-stack/lan/ca.pem';
 if(environment.TEST_CLOUD_PUBLIC_REMOTE==='1'){
  if(role==='manifest')for(const name of ['TEST_CLOUD_TLS_CHALLENGE_DIR','TEST_CLOUD_GATEWAY_STATUS_DIR'])if(environment[name]!==undefined)result[name]=environment[name];
  if(role==='gateway'){
   result.GATEWAY_PROXY_SOURCE='10.79.0.2';
   for(const name of ['GATEWAY_CHALLENGES','GATEWAY_STATUS_DIR'])if(environment[name]!==undefined)result[name]=environment[name];
  }
 }
 if(role==='email')result.CLOUD_MAIL_TRANSPORT='test-capture';
 if(environment.CLOUD_TEST_AMAZON_BACKUPS==='1'){
  const origin=environment.TEST_CLOUD_ORIGIN;
  if(environment.TEST_CLOUD_AMAZON!=='1'||environment.NODE_ENV==='production'||mode!=='test-venue-levels'||!origin||new URL(origin).port)throw Error('test_cloud.amazon_backups');
  if(role==='account'||role==='backup')result.CLOUD_TEST_AMAZON_BACKUPS='1';
  if(role==='backup')for(const name of ['CLOUD_VERIFIER_SCRATCH_VOLUME','CLOUD_BACKUP_STAGE_ROOT'])
   if(environment[name]!==undefined)result[name]=environment[name];
 }
 if(role==='backup'&&enabled){result.CLOUD_VERIFIER_STATE_DIR='/run/backup-verifier';result.CLOUD_BACKUP_ENDPOINT='https://waitron.local:8333';result.CLOUD_BACKUP_CA_FILE='/run/local-stack/lan/ca.pem';if(environment.CLOUD_VERIFIER_IMAGE!==undefined)result.CLOUD_VERIFIER_IMAGE=environment.CLOUD_VERIFIER_IMAGE;}
 if(role==='account'){
  const liveMenu=environment.TEST_CLOUD_LIVE_GUEST_MENU??'0';
  if(liveMenu!=='0'){
   if(liveMenu!=='1'||mode!=='test-venue-levels'||environment.NODE_ENV==='production')throw Error('test_cloud.live_guest_menu');
   result.TEST_CLOUD_LIVE_GUEST_MENU='1';
  }
 }
 if(role==='account'&&mode==='test-venue-levels'){
  if(environment.TEST_CLOUD_AMAZON==='1'&&environment.TEST_CLOUD_GUEST_MENU==='1'&&environment.NODE_ENV!=='production'){
   const origin=new URL(result.CLOUD_PORTAL_ORIGIN);
   if(origin.port||!environment.TEST_CLOUD_ORIGIN)throw Error('test_cloud.guest_origin');
   result.GUEST_ORIGIN='https://menus.'+origin.hostname;
  }
  result.TEST_CLOUD_TUNNEL_CELL_ID=config.gateway.cellId;
  for(const name of ['CLOUD_SETUP_PAIRING_PUBLIC_KEY','CLOUD_SETUP_PAIRING_REDIRECT_URI','CLOUD_TEST_RELAY_SETUP_EXPIRES_AT','CLOUD_VENUE_MAIL_DNS_SUFFIX'])
   if(environment[name])result[name]=environment[name];
  for(const name of ['CLOUD_BACKUP_STAGE_ROOT','CLOUD_BILLING_ACCOUNT_TEST_IDS','CLOUD_BILLING_METHODS_MODE'])if(environment[name]!==undefined)result[name]=environment[name];
  if(result.CLOUD_BILLING_METHODS_MODE==='test'){
   for(const name of ['CLOUD_BILLING_STRIPE_TEST_ACCOUNT','CLOUD_BILLING_STRIPE_TEST_KEY','CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT','CLOUD_BILLING_SUMUP_SANDBOX_KEY']){
    if(environment[name]!==undefined)result[name]=environment[name];
   }
  }
 }
 return result;
}
export async function spawnExitWorker(directory,args,options){
 const info=await lstat(directory);
 if(!info.isDirectory()||(info.mode&0o077))throw Error('test_cloud.exit_stage');
 // A directory lock survives exec and belongs to the worker until the process exits.
 return spawn('flock',['--nonblock','--no-fork','--',directory,process.execPath,...args],{
  ...options,env:{...options.env,CLOUD_EXIT_STAGE_LOCKED:'1'}
 });
}

export async function openExitStage(directory,locked){
 if(directory===undefined)return undefined;
 if(locked!=='1')throw Error('test_cloud.exit_stage');
 await rm(join(directory,'exit-download'),{force:true,recursive:true});
 return {stageRoot:directory,enabled:false};
}

export async function launchTestRuntime(role,directory=process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack',demoCommand='--fail'){
 const config=await loadRuntime(directory),environment=testRuntimeEnvironment(role,config,process.env),command=testRuntimeCommand(role);
 if(role!=='migrate'&&environment.DATABASE_URL)await checkConsumerDatabase(environment.DATABASE_URL,'/app');
 const args=role==='action-demo'?[demoCommand]:role==='usage'?['--watch']:role==='reconcile'?['/run/reconciler/config.json']:[];
 const childEnvironment={PATH:process.env.PATH,HOME:'/tmp',LOCAL_STACK_CONFIG_DIR:directory,...environment};
 // Replace the launcher to avoid retaining its heap beside the worker.
 if(['monitor','usage','probe','manifest'].includes(role)||role==='backup'&&environment.CLOUD_TEST_AMAZON_BACKUPS==='1'){
  process.chdir('/app');
  return process.execve(process.execPath,[process.execPath,command,...args],childEnvironment);
 }
 const options={cwd:'/app',stdio:'inherit',env:childEnvironment};
 const child=environment.CLOUD_EXIT_STAGE_ROOT
  ?await spawnExitWorker(environment.CLOUD_EXIT_STAGE_ROOT,[command,...args],options)
  :spawn(process.execPath,[command,...args],options);
 const forward=signal=>child.kill(signal);process.once('SIGINT',forward);process.once('SIGTERM',forward);
 try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
 finally{process.removeListener('SIGINT',forward);process.removeListener('SIGTERM',forward);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=await launchTestRuntime(process.argv[2],undefined,process.argv[3]);}catch{console.error('Test Cloud runtime failed; check private configuration and schema');process.exitCode=1;}}
