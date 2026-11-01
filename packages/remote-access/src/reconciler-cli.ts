import {createPrivateKey,type KeyObject} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {runWorkerLoop,parsePlanMode} from '@waitron-cloud/registration';
import {issueCertificate,type DnsChallengeProvider} from './certificates.ts';
import {isUuid} from './manifest.ts';
import {FileReconcilerArtifacts} from './reconciler-files.ts';
import {RemoteConfigurationReconciler,remoteConfigurationStatus} from './reconciler.ts';

interface RouteConfig {cellId:string;output:string;signingKeyFile:string}
interface CertificateConfig {installationId:string;kind:'staff'|'public';csrFile:string;output:string}
interface Configuration {staffExchange?:boolean;forwardReports?:boolean;routes:RouteConfig[];certificates:CertificateConfig[];acme:{directoryUrl:string;email:string;accountKeyFile:string;dnsModule:string}}

let pool:Pool|undefined;const stop=new AbortController(),shutdown=()=>stop.abort();process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
function absolute(value:unknown):value is string{return typeof value==='string'&&isAbsolute(value);}
function validate(value:unknown):asserts value is Configuration {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();const config=value as Partial<Configuration>;
 if(!Array.isArray(config.routes)||!Array.isArray(config.certificates)||!config.acme||typeof config.acme!=='object')throw new Error();
 if(config.forwardReports!==undefined&&typeof config.forwardReports!=='boolean')throw new Error();
 if(config.staffExchange!==undefined&&typeof config.staffExchange!=='boolean')throw new Error();
 if(config.staffExchange&&config.certificates.some(c=>c.kind==='staff'))throw new Error();
 const routeIds=new Set<string>();for(const route of config.routes){if(!isUuid(route.cellId)||!absolute(route.output)||!absolute(route.signingKeyFile)||routeIds.has(route.cellId))throw new Error();routeIds.add(route.cellId);}
 const certificateIds=new Set<string>();for(const certificate of config.certificates){const key=`${certificate.installationId}:${certificate.kind}`;if(!isUuid(certificate.installationId)||!['staff','public'].includes(certificate.kind)||!absolute(certificate.csrFile)||!absolute(certificate.output)||certificateIds.has(key))throw new Error();certificateIds.add(key);}
 if(typeof config.acme.directoryUrl!=='string'||typeof config.acme.email!=='string'||!absolute(config.acme.accountKeyFile)||!absolute(config.acme.dnsModule))throw new Error();
 const url=new URL(config.acme.directoryUrl);if(url.protocol!=='https:'||url.username||url.password||!config.acme.email.includes('@'))throw new Error();
}
try{
 const planMode=parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS);
 const [configFile,mode,...extra]=process.argv.slice(2);if(!configFile||extra.length||mode&&!['--once','--status'].includes(mode)||!process.env.DATABASE_URL)throw new Error();
 const config:unknown=JSON.parse(await readFile(configFile,'utf8'));validate(config);
 const artifacts=new FileReconcilerArtifacts({routes:config.routes,certificates:config.certificates}),keys=new Map<string,KeyObject>();
 for(const route of config.routes){const key=createPrivateKey(await readFile(route.signingKeyFile));if(key.asymmetricKeyType!=='ed25519')throw new Error();keys.set(route.cellId,key);}
 const dns: DnsChallengeProvider=(await import(pathToFileURL(config.acme.dnsModule).href)).default;if(typeof dns?.present!=='function'||typeof dns?.remove!=='function')throw new Error();
 const accountKey=await readFile(config.acme.accountKeyFile);pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:10000});pool.on('error',()=>console.error('Remote configuration database connection failed; retrying'));
 await pool.query('SELECT claim_id,lease_until FROM remote_configuration_jobs LIMIT 0');
 const worker=new RemoteConfigurationReconciler(pool,{planMode,staffExchange:config.staffExchange,forwardReports:config.forwardReports,artifacts,signingKeyForCell:async cellId=>{const key=keys.get(cellId);if(!key)throw new Error('route_mapping_missing');return key;},
  issueCertificate:target=>issueCertificate({directoryUrl:config.acme.directoryUrl,accountKey,email:config.acme.email,csr:target.csr,hostname:target.hostname,dnsName:target.dnsName,dns,signal:target.signal})});
 if(mode==='--status')console.log(JSON.stringify(await remoteConfigurationStatus(pool)));
 else if(mode==='--once'){await worker.schedule();await worker.runOnce(stop.signal);console.log(JSON.stringify(await remoteConfigurationStatus(pool)));}
 else await runWorkerLoop({signal:stop.signal,concurrency:4,scheduleIntervalMs:5000,pollIntervalMs:1000,schedule:()=>worker.schedule(),runOnce:signal=>worker.runOnce(signal),onError:()=>console.error('Remote configuration reconciliation failed; retrying')});
}catch{
 console.error('Remote configuration reconciler failed; check its trusted configuration and database migrations');process.exitCode=1;
}finally{
 try{await pool?.end();}catch{process.exitCode=1;}process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
}
