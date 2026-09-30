import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {request} from 'node:https';
export const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();
export async function waitFor(check,timeout=30000){const until=Date.now()+timeout;let last;while(Date.now()<until){try{const result=await check();if(result)return result;}catch(error){last=error;}await delay(100);}throw new Error('Timed out waiting for local fixture',{cause:last});}
export async function startAcme(){
 const name='cloud-acme-'+randomUUID(),root=await mkdtemp(join(tmpdir(),'cloud-acme-'));const owned=[];
 docker('network','create',name);
 const close=async()=>{for(const id of owned.reverse()){try{docker('rm','-f',id);}catch{}}try{docker('network','rm',name);}finally{await rm(root,{recursive:true,force:true});}};
 try{
  owned.push(docker('run','-d','--network',name,'--name',name+'-dns','-p','127.0.0.1::8055','ghcr.io/letsencrypt/pebble-challtestsrv@sha256:12ce21884def456bcf9786542113949e1f19dc7738d2c70e156c2d0c38a1405b','-defaultIPv6',''));
  const dnsIp=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name+'-dns');
  const dnsPort=docker('port',name+'-dns','8055/tcp').split(':').at(-1),dnsUrl=`http://127.0.0.1:${dnsPort}`;
  owned.push(docker('run','-d','--network',name,'--name',name+'-ca','-p','127.0.0.1::14000','-p','127.0.0.1::15000','-e','PEBBLE_VA_NOSLEEP=1','-e','PEBBLE_AUTHZREUSE=0','ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199','-config','test/config/pebble-config.json','-strict','-dnsserver',dnsIp+':8053'));
  docker('cp',name+'-ca:/test/certs/pebble.minica.pem',join(root,'acme-root.pem'));
  const ca=await readFile(join(root,'acme-root.pem'));
  const port=docker('port',name+'-ca','14000/tcp').split(':').at(-1),management=docker('port',name+'-ca','15000/tcp').split(':').at(-1);
  const get=path=>new Promise((resolve,reject)=>{const req=request({host:'localhost',family:4,port:path==='/dir'?port:management,path,ca,headers:{'User-Agent':'waitron-cloud-local-test'}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>res.statusCode===200?resolve(body):reject(Error('ACME status '+res.statusCode+': '+body.slice(0,1000))));});req.setTimeout(2000,()=>req.destroy(Error('ACME timeout')));req.on('error',reject);req.end();});
  await waitFor(()=>get('/dir'),5000);const certificateRoot=await get('/roots/0');
  return {root,name,dnsUrl,certificateRoot,directoryUrl:`https://localhost:${port}/dir`,close,
   async issue({hostname,csrFile,accountKeyFile,output,dnsName=`_acme-challenge.${hostname}`,omitDns=false,operator}){
    const file=join(root,randomUUID()+'.json');await writeFile(file,JSON.stringify({directoryUrl:`https://localhost:${port}/dir`,dnsUrl,hostname,csrFile,accountKeyFile,output,dnsName,omitDns}),{mode:0o600});
    let args=['scripts/remote-acme-worker.mjs',file];
    if(operator){const dnsModule=join(root,'dns-provider.mjs');await writeFile(dnsModule,`const base=${JSON.stringify(dnsUrl)};async function call(path,body){const r=await fetch(base+path,{method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('dns_failed');}export default {present:(name,value)=>call('/set-txt',{host:name+'.',value}),remove:(name)=>call('/clear-txt',{host:name+'.'})};`);await writeFile(file,JSON.stringify({installationId:operator.installationId,kind:operator.kind,csrFile,accountKeyFile,output,dnsModule,directoryUrl:`https://localhost:${port}/dir`,email:'local@example.test',force:true}),{mode:0o600});args=['packages/remote-access/src/operator-cli.ts','certificate',file];}
    const child=spawn(process.execPath,args,{cwd:process.cwd(),env:{...process.env,...(operator?{DATABASE_URL:operator.databaseUrl}:{}),NODE_EXTRA_CA_CERTS:join(root,'acme-root.pem')},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
    try{const code=await new Promise(resolve=>child.once('exit',resolve));if(code!==0)throw new Error(logs.trim()||'ACME worker failed');return await readFile(output,'utf8');}finally{clearTimeout(timer);await rm(file,{force:true});}
   }};
 }catch(error){await close();throw error;}
}
