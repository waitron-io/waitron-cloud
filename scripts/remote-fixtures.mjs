import {Resolver} from 'node:dns/promises';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {request} from 'node:https';
export const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000}).trim();
export async function waitFor(check,timeout=30000){const until=Date.now()+timeout;let last;while(Date.now()<until){try{const result=await check();if(result)return result;}catch(error){last=error;}await delay(100);}throw new Error('Timed out waiting for local fixture',{cause:last});}
async function dnsRecord(dnsUrl,path,value){
 const response=await fetch(dnsUrl+path,{method:'POST',body:JSON.stringify(value),signal:AbortSignal.timeout(3000)});
 await response.text();if(!response.ok)throw Error('dns_failed');
}
export const pointPebbleName=(dnsUrl,host,target)=>dnsRecord(dnsUrl,'/set-cname',{host:host+'.',target:target+'.'});
export async function startAcme({http,tlsAlpn=false}={}){
 const name='cloud-acme-'+randomUUID(),root=await mkdtemp(join(tmpdir(),'cloud-acme-'));const owned=[];let cnameResolver;
 docker('network','create',name);
 const configured=Boolean(http||tlsAlpn);
 const close=async()=>{cnameResolver?.cancel();for(const id of owned.reverse()){try{docker('rm','-f',id);}catch{}}try{docker('network','rm',name);}finally{await rm(root,{recursive:true,force:true});}};
 try{
  let httpIp;
  if(http){
   const source=join(root,'http-source');
   for(const file of ['deploy/test-cloud/http-challenges.mjs','packages/remote-access/src/manifest.ts']){await mkdir(join(source,file,'..'),{recursive:true});await copyFile(new URL('../'+file,import.meta.url),join(source,file));}
   await writeFile(join(source,'package.json'),JSON.stringify({type:'module'}));
   owned.push(docker('run','-d','--read-only','--memory','64m','--network',name,'--name',name+'-http','-p','127.0.0.1::80','-v',source+':/app:ro','-v',http.challengeDirectory+':/challenges:ro','-v',http.accountWebroot+':/account:ro','-e','TEST_CLOUD_ORIGIN=https://'+http.zone,'-e','TEST_CLOUD_REMOTE_ZONE='+http.zone,'-e','TEST_CLOUD_ACCOUNT_WEBROOT=/account','-e','TEST_CLOUD_CHALLENGE_DIR=/challenges','-e','TEST_CLOUD_HTTP_PORT=80','node:26-alpine3.23','node','/app/deploy/test-cloud/http-challenges.mjs'));
   await waitFor(()=>docker('logs',name+'-http').includes('listening'),5000);httpIp=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name+'-http');
  }
  owned.push(docker('run','-d','--network',name,'--name',name+'-dns','-p','127.0.0.1::8055','-p','127.0.0.1::8053/udp','ghcr.io/letsencrypt/pebble-challtestsrv@sha256:12ce21884def456bcf9786542113949e1f19dc7738d2c70e156c2d0c38a1405b','-defaultIPv6','',...(http?['-defaultIPv4',httpIp]:[])));
  const dnsIp=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name+'-dns');
  const dnsPort=docker('port',name+'-dns','8055/tcp').split(':').at(-1),dnsUrl=`http://127.0.0.1:${dnsPort}`;
  const lookupPort=docker('port',name+'-dns','8053/udp').split(':').at(-1);cnameResolver=new Resolver({timeout:1000,tries:1});cnameResolver.setServers([`127.0.0.1:${lookupPort}`]);
  owned.push(docker(configured?'create':'run',...(configured?[]:['-d']),'--network',name,'--name',name+'-ca','-p','127.0.0.1::14000','-p','127.0.0.1::15000','-e','PEBBLE_VA_NOSLEEP=1','-e','PEBBLE_AUTHZREUSE=0',...(configured?['-v',root+':/config:ro']:[]),'ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199','-config',configured?'/config/pebble.json':'test/config/pebble-config.json','-strict','-dnsserver',dnsIp+':8053'));
  if(configured){
   const configuration=join(root,'pebble.json');
   docker('cp',name+'-ca:/test/config/pebble-config.json',configuration);
   const value=JSON.parse(await readFile(configuration,'utf8'));
   if(http)value.pebble.httpPort=80;
   if(tlsAlpn)value.pebble.tlsPort=443;
   await writeFile(configuration,JSON.stringify(value));docker('start',name+'-ca');
  }
  docker('cp',name+'-ca:/test/certs/pebble.minica.pem',join(root,'acme-root.pem'));
  const ca=await readFile(join(root,'acme-root.pem'));
  const port=docker('port',name+'-ca','14000/tcp').split(':').at(-1),management=docker('port',name+'-ca','15000/tcp').split(':').at(-1);
  const get=path=>new Promise((resolve,reject)=>{const req=request({host:'localhost',family:4,port:path==='/dir'?port:management,path,ca,headers:{'User-Agent':'waitron-cloud-local-test'}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>res.statusCode===200?resolve(body):reject(Error('ACME status '+res.statusCode+': '+body.slice(0,1000))));});req.setTimeout(2000,()=>req.destroy(Error('ACME timeout')));req.on('error',reject);req.end();});
  await waitFor(()=>get('/dir'),5000);const certificateRoot=await get('/roots/0');
  return {root,name,dnsUrl,certificateRoot,dnsServer:`127.0.0.1:${lookupPort}`,
   resolveCname:hostname=>cnameResolver.resolveCname(hostname),
   point:(host,target)=>pointPebbleName(dnsUrl,host,target),
   async setA(name,address){
    const host=name+'.';
    await dnsRecord(dnsUrl,'/clear-a',{host});
    await dnsRecord(dnsUrl,'/add-a',{host,addresses:[address]});
   },
   connectGateway(container){
    docker('network','connect',name,container);
    return docker('inspect','--format','{{(index .NetworkSettings.Networks "'+name+'").IPAddress}}',container);
   },directoryUrl:`https://localhost:${port}/dir`,httpReady:Boolean(http),httpUrl:http?'http://127.0.0.1:'+docker('port',name+'-http','80/tcp').split(':').at(-1):undefined,close,
   async issue({hostname,csrFile,accountKeyFile,output,dnsName=`_acme-challenge.${hostname}`,omitDns=false,http:httpIssue}){
    const file=join(root,randomUUID()+'.json');await writeFile(file,JSON.stringify({directoryUrl:`https://localhost:${port}/dir`,dnsUrl,hostname,csrFile,accountKeyFile,output,dnsName,omitDns,http:httpIssue}),{mode:0o600});
    const args=['scripts/remote-acme-worker.mjs',file];
    const child=spawn(process.execPath,args,{cwd:process.cwd(),env:{...process.env,NODE_EXTRA_CA_CERTS:join(root,'acme-root.pem')},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
    try{const code=await new Promise(resolve=>child.once('exit',resolve));if(code!==0)throw new Error(logs.trim()||'ACME worker failed');if(httpIssue?.abortOnChallenge)console.error('Abort control completed: '+logs.trim());return await readFile(output,'utf8');}finally{clearTimeout(timer);await rm(file,{force:true});}
   }};
 }catch(error){await close();throw error;}
}
