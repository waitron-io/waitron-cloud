import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {issueCertificate} from '../packages/remote-access/src/certificates.ts';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
async function call(path,body){const response=await fetch(config.dnsUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error('dns_update_failed');}
let stage='configuration',observer;const stop=new AbortController();
try{
 let cert;
 if(config.http){
  const {issueTestRemoteCertificate}=await import('../deploy/test-cloud/remote-runtime.mjs'),accountKey=await readFile(config.accountKeyFile);
  if(config.http.abortOnChallenge){const path=join(config.http.challengeDirectory,config.hostname);await mkdir(path,{recursive:true});observer=setInterval(()=>{void readdir(path).then(files=>{if(files.some(file=>/^[A-Za-z0-9_-]{1,128}$/.test(file))){console.error(JSON.stringify({stage:'challenge-observer',canonical:true}));stop.abort();clearInterval(observer);}}).catch(()=>{});},1);}
  stage='http-issuance';cert=await issueTestRemoteCertificate(dirname(config.csrFile),{hostname:config.hostname,csr:await readFile(config.csrFile,'utf8'),signal:stop.signal},{...config.http,directoryUrl:config.directoryUrl,accountKey});
  const {Client}=createRequire(new URL('../packages/remote-access/package.json',import.meta.url))('acme-client');
  stage='account-readback';const account=await new Client({directoryUrl:config.directoryUrl,accountKey}).createAccount({onlyReturnExisting:true});
  await writeFile(config.output+'.account.json',JSON.stringify({contact:account.contact??[]}),{mode:0o600});
 }else cert=await issueCertificate({directoryUrl:config.directoryUrl,accountKey:await readFile(config.accountKeyFile),email:'local-test@example.test',hostname:config.hostname,csr:await readFile(config.csrFile,'utf8'),dnsName:config.dnsName,
  dns:{present:async(name,value)=>{if(!config.omitDns)await call('/set-txt',{host:name+'.',value});},remove:async name=>call('/clear-txt',{host:name+'.'})}});
 await writeFile(config.output,cert,{mode:0o600});
}catch(error){console.error('certificate_issuance_failed '+JSON.stringify({stage,error:error?.name,aborted:stop.signal.aborted,reason:/^(test_cloud\.[a-z_]+|invalid_csr)$/.test(error?.message??'')?error.message:undefined,localProblem:config.http&&new URL(config.directoryUrl).hostname==='localhost'&&error?.stack?.includes('acme-client/src/api.js')?error.message.replace(/https?:\/\/[^\s]+/g,'[url]').replace(/[A-Za-z0-9_-]{20,}/g,'[value]').slice(0,400):undefined,frame:error?.stack?.split('\n')[1]?.trim(),code:/^[A-Z_]{1,40}$/.test(error?.code??'')?error.code:undefined,status:error?.response?.status,problemType:error?.response?.data?.type}));process.exitCode=1;}
finally{clearInterval(observer);}
