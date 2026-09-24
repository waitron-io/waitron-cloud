import {readFile,writeFile} from 'node:fs/promises';
import {issueCertificate} from '../packages/remote-access/src/certificates.ts';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
async function call(path,body){const response=await fetch(config.dnsUrl+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error('dns_update_failed');}
try{
 const cert=await issueCertificate({directoryUrl:config.directoryUrl,accountKey:await readFile(config.accountKeyFile),email:'local-test@example.test',hostname:config.hostname,csr:await readFile(config.csrFile,'utf8'),dnsName:config.dnsName,
  dns:{present:async(name,value)=>{if(!config.omitDns)await call('/set-txt',{host:name+'.',value});},remove:async name=>call('/clear-txt',{host:name+'.'})}});
 await writeFile(config.output,cert,{mode:0o600});
}catch{console.error('certificate_issuance_failed');process.exitCode=1;}
