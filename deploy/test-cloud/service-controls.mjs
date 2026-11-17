import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createLeaseIssuer,createLeaseTrust,parsePlanMode,transaction} from '../../packages/registration/src/index.ts';
import {RelayGrantStore} from '../../packages/registration/src/relay-grants.ts';
import {RelayControl} from '../../packages/registration/src/relay-control.ts';
import {testRelaySettings} from './relay-settings.mjs';
import {setGuestMenuBlocked} from '../../packages/remote-access/src/guest-menu.ts';
import {checkConsumerSchema,canonicalHttpsOrigin,loadRuntime,runtimeEnvironment} from '../local-stack/runtime.mjs';
const {Pool}=createRequire(new URL('../../packages/registration/package.json',import.meta.url))('pg');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function testMode(environment){
 try{if(parsePlanMode(environment.CLOUD_TEST_SERVICE_PLANS,environment.CLOUD_VENUE_SERVICE_LEVELS)!=='test-venue-levels')throw Error();}
 catch{throw Error('test_cloud.service_mode');}
}
export async function executeTestServiceCommand({pool,issuer,origin,environment},input){
 testMode(environment);canonicalHttpsOrigin(origin);
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('test_cloud.service_command');
 const control=new RelayControl(pool);
 switch(input.command){
  case 'relay-stop':return control.stop();
  case 'relay-resume':return control.resume();
  case 'relay-status':return control.status();
  case 'guest-menu':{
   if(!uuid.test(input.venueId)||typeof input.enabled!=='boolean')throw Error('test_cloud.service_command');
   return transaction(pool,async client=>{
    const venue=(await client.query('SELECT environment FROM venues WHERE id=$1 FOR NO KEY UPDATE',[input.venueId])).rows[0];
    if(venue?.environment!=='test')throw Error('test_cloud.service_target');
    const menu=await setGuestMenuBlocked(client,input.venueId,!input.enabled,origin);
    return {state:menu.state,revision:menu.revision};
   });
  }
  case 'relay-approve':{
   if(!input.statement||!input.session||!input.approval||!issuer)throw Error('test_cloud.service_command');
   const config={mode:'local-proof',...testRelaySettings,
    testOrigin:{environment:'test',origin,trusted:createLeaseTrust(issuer)},
    verifyOrigin:async()=>{throw Error('origin_unverified');}};
   const grant=await new RelayGrantStore(pool,config,'test-venue-levels').approve(input.session.token,input.session.csrfToken,input.approval,input.statement);
   return {id:grant.id,installationId:grant.installationId,revision:grant.revision,expiresAt:grant.expiresAt,enabled:grant.enabled};
  }
  case 'relay-revoke':
   if(!input.session)throw Error('test_cloud.service_command');
   await new RelayGrantStore(pool).revoke(input.session.token,input.session.csrfToken,input.grantId);
   return {revoked:true};
  default:throw Error('test_cloud.service_command');
 }
}

async function main(){
 let pool;
 try{
  if(process.argv.length!==2)throw Error();
  testMode(process.env);
  const directory=process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack',config=await loadRuntime(directory);
  const origin=process.env.TEST_CLOUD_ORIGIN??'https://waitron.local:3000';
  const connection=new URL(process.env.DATABASE_URL??runtimeEnvironment('account',config,{},origin).DATABASE_URL);
  connection.searchParams.set('options',`${connection.searchParams.get('options')??''} -c statement_timeout=10000 -c transaction_timeout=15000`);
  pool=new Pool({connectionString:connection.href,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});
  pool.on('error',()=>{process.exitCode=1;});
  await checkConsumerSchema(pool,fileURLToPath(new URL('../../',import.meta.url)));
  const parts=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>32768)throw Error();parts.push(chunk);}
  const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
  const result=await executeTestServiceCommand({pool,issuer:createLeaseIssuer(config.installation.issuerKey),origin,environment:process.env},input);
  console.log(JSON.stringify(result));
 }catch{console.error('Test service command failed; check test mode, private input, owner session and schema');process.exitCode=1;}
 finally{try{await pool?.end();}catch{process.exitCode=1;}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
