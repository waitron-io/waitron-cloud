import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {loadRuntime,runtimeEnvironment,checkConsumerDatabase} from '../local-stack/runtime.mjs';
const commands={migrate:'packages/registration/src/migrate-cli.ts',account:'deploy/test-cloud/account-worker.mjs',storage:'deploy/test-cloud/storage-worker.mjs',email:'deploy/test-cloud/email-worker.mjs',monitor:'packages/registration/src/monitor-cli.ts',usage:'packages/registration/src/usage-reconcile-cli.ts',probe:'packages/remote-access/src/probe-cli.ts',backup:'packages/backups/src/worker-cli.ts',gateway:'packages/remote-access/src/gateway-cli.ts',manifest:'deploy/test-cloud/remote-worker.mjs',reconcile:'packages/remote-access/src/reconciler-cli.ts',translation:'packages/translation/src/worker-cli.ts'};
export function testRuntimeCommand(role){if(!Object.hasOwn(commands,role))throw new Error('test_cloud.role_invalid');return commands[role];}
export function testRuntimeEnvironment(role,config,environment={}){
 testRuntimeCommand(role);
 const flag=environment.CLOUD_TEST_SERVICE_PLANS??'0';if(!['0','1'].includes(flag))throw new Error('test_cloud.plan_mode');
 const result=runtimeEnvironment(role==='storage'||role==='manifest'&&flag==='1'?'reconcile':role,config,{},'https://waitron.local:3000');result.CLOUD_TEST_SERVICE_PLANS=flag;
 if(['account','storage','backup'].includes(role))result.NODE_EXTRA_CA_CERTS='/run/local-stack/lan/ca.pem';
 if(role==='account'){result.CLOUD_TRANSLATION='0';result.CLOUD_HTTP_TRUSTED_PROXY_IPS='10.79.0.2';if(flag==='1')result.CLOUD_STAFF_CERTIFICATES='1';}
 if(role==='gateway'){result.GATEWAY_UPSTREAM_CA='/run/local-stack/lan/ca.pem';result.GATEWAY_CERTIFICATE_REFRESH='1';}
 if(role==='email')result.CLOUD_MAIL_TRANSPORT='test-capture';
 if(role==='backup'&&flag==='1'){result.CLOUD_BACKUP_ENDPOINT='https://waitron.local:8333';result.CLOUD_BACKUP_CA_FILE='/run/local-stack/lan/ca.pem';}
 return result;
}
export async function launchTestRuntime(role,directory=process.env.LOCAL_STACK_CONFIG_DIR??'/run/local-stack'){
 const config=await loadRuntime(directory),environment=testRuntimeEnvironment(role,config,process.env),command=testRuntimeCommand(role);
 if(role!=='migrate'&&environment.DATABASE_URL)await checkConsumerDatabase(environment.DATABASE_URL,'/app');
 const args=role==='usage'?['--watch']:role==='reconcile'?['/run/reconciler/config.json']:[];
 const child=spawn(process.execPath,[command,...args],{cwd:'/app',stdio:'inherit',env:{PATH:process.env.PATH,HOME:'/tmp',LOCAL_STACK_CONFIG_DIR:directory,...environment}});
 const forward=signal=>child.kill(signal);process.once('SIGINT',forward);process.once('SIGTERM',forward);
 try{return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});}
 finally{process.removeListener('SIGINT',forward);process.removeListener('SIGTERM',forward);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.exitCode=await launchTestRuntime(process.argv[2]);}catch{console.error('Test Cloud runtime failed; check private configuration and schema');process.exitCode=1;}}
