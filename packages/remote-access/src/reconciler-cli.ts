import {createPrivateKey,type KeyObject} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {runWorkerLoop,parsePlanMode} from '@waitron-cloud/registration';
import {issueCertificate,type DnsChallengeProvider} from './certificates.ts';
import {isUuid} from './manifest.ts';
import {answerableNames} from './gateway-status.ts';
import {FileReconcilerArtifacts} from './reconciler-files.ts';
import {RemoteConfigurationReconciler,remoteConfigurationStatus} from './reconciler.ts';

interface RouteConfig {cellId:string;output:string;signingKeyFile:string;publicCertificates:string;challenges?:string;statusDirectory?:string}
interface Configuration {keyDirectory:string;forwardReports?:boolean;routes:RouteConfig[];acme:{directoryUrl:string;email:string;accountKeyFile:string;dnsModule:string}}

let pool:Pool|undefined;const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
function absolute(value:unknown):value is string{return typeof value==='string'&&isAbsolute(value);}
function validate(value:unknown):asserts value is Configuration {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();const config=value as Partial<Configuration>;
 if(!Array.isArray(config.routes)||!absolute(config.keyDirectory)||'certificates'in config||'staffExchange'in config||!config.acme||typeof config.acme!=='object')throw new Error();
 if(config.forwardReports!==undefined&&typeof config.forwardReports!=='boolean')throw new Error();
 const routeIds=new Set<string>();
 for(const route of config.routes){
  if(!route||!isUuid(route.cellId)||!absolute(route.output)||!absolute(route.signingKeyFile)||!absolute(route.publicCertificates)||routeIds.has(route.cellId))throw new Error();
  if((route.challenges!==undefined||route.statusDirectory!==undefined)&&(!absolute(route.challenges)||!absolute(route.statusDirectory)))throw new Error();
  routeIds.add(route.cellId);
 }
 // A custom-name worker needs the check and status paths for every cell it can serve.
 if(config.routes.some(route=>route.statusDirectory!==undefined)&&config.routes.some(route=>route.statusDirectory===undefined))throw new Error();
 if(typeof config.acme.directoryUrl!=='string'||typeof config.acme.email!=='string'||!absolute(config.acme.accountKeyFile)||!absolute(config.acme.dnsModule))throw new Error();
 const url=new URL(config.acme.directoryUrl);if(url.protocol!=='https:'||url.username||url.password||!config.acme.email.includes('@'))throw new Error();
}
try{
 const planMode=parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS);
 const [configFile,mode,...extra]=process.argv.slice(2);if(!configFile||extra.length||mode&&!['--once','--status'].includes(mode)||!process.env.DATABASE_URL)throw new Error();
 const config:unknown=JSON.parse(await readFile(configFile,'utf8'));validate(config);
 const artifacts=new FileReconcilerArtifacts({routes:config.routes,keyDirectory:config.keyDirectory}),keys=new Map<string,KeyObject>();
 for(const route of config.routes){const key=createPrivateKey(await readFile(route.signingKeyFile));if(key.asymmetricKeyType!=='ed25519')throw new Error();keys.set(route.cellId,key);}
 const dns: DnsChallengeProvider=(await import(pathToFileURL(config.acme.dnsModule).href)).default;if(typeof dns?.present!=='function'||typeof dns?.remove!=='function'||typeof dns?.point!=='function')throw new Error();
 const accountKey=await readFile(config.acme.accountKeyFile);pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});pool.on('error',()=>console.error('Remote configuration database connection failed; retrying'));
 await pool.query('SELECT claim_id,lease_until FROM remote_configuration_jobs LIMIT 0');
 const statusDirectories=new Map(config.routes.flatMap(route=>route.statusDirectory?[[route.cellId,route.statusDirectory] as const]:[]));
 const gatewayStatus=statusDirectories.size?{async read(cellId:string){
  const directory=statusDirectories.get(cellId);
  return directory?[answerableNames(await readFile(join(directory,'status.json'),'utf8'))]:[];
 }}:undefined;
 const worker=new RemoteConfigurationReconciler(pool,{planMode,forwardReports:config.forwardReports,artifacts,gatewayStatus,pointName:(name,target,signal)=>dns.point(name,target,signal),signingKeyForCell:async cellId=>{const key=keys.get(cellId);if(!key)throw new Error('route_mapping_missing');return key;},
  issueCertificate:target=>issueCertificate({directoryUrl:config.acme.directoryUrl,accountKey,email:config.acme.email,csr:target.csr,hostname:target.hostname,validation:target.validation.type==='dns-01'?{...target.validation,dns}:target.validation,signal:target.signal})});
 if(mode==='--status')console.log(JSON.stringify(await remoteConfigurationStatus(pool)));
 else if(mode==='--once'){await worker.schedule();await worker.runOnce(stop.signal);console.log(JSON.stringify(await remoteConfigurationStatus(pool)));}
 else await runWorkerLoop({signal:stop.signal,concurrency:4,scheduleIntervalMs:5000,pollIntervalMs:1000,schedule:()=>worker.schedule(),runOnce:signal=>worker.runOnce(signal),onError:()=>console.error('Remote configuration reconciliation failed; retrying')});
}catch{
 console.error('Remote configuration reconciler failed; check its trusted configuration and database migrations');process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
