import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {signManifest} from '../packages/remote-access/src/manifest.ts';
import {docker,waitFor} from './remote-fixtures.mjs';
import {verifyGatewayReconnectionReceipt} from './verify-gateway-reconnection-receipt.mjs';

const output=process.argv[2];if(!output)throw Error('Usage: gateway-reconnection-receipt.mjs RECEIPT.json');
const run=(cmd,...args)=>execFileSync(cmd,args,{encoding:'utf8',timeout:120000}).trim();
const cloudHead=run('git','rev-parse','HEAD'),cloudDirty=run('git','status','--porcelain')!=='';
assert.equal(cloudDirty,false,'Commit the measurement source before running it');
const root=await mkdtemp(join(tmpdir(),'cloud-reconnection-')),name='cloud-reconnection-'+randomUUID();
const image=name+':local',gateway=name+'-gateway',peer=name+'-peer',owned=new Set();
let networkCreated=false,imageCreated=false,port,ip,sequence=0;
const input=join(root,'gateway'),state=join(root,'state'),peerInput=join(root,'peer');
const staffHostname='staff.reconnect.example.test',publicHostname='public.reconnect.example.test';
const cellId=randomUUID(),marker=randomUUID(),issuer=generateKeyPairSync('ed25519');
const wireguardKey=()=>{const key=generateKeyPairSync('x25519');return {
 privateKey:key.privateKey.export({type:'pkcs8',format:'der'}).subarray(-32).toString('base64'),
 publicKey:key.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64')};};
const gatewayKey=wireguardKey(),peerKey=wireguardKey(),trials=[];
const secret=(file,value)=>writeFile(file,value,{mode:0o600});
const remove=id=>{docker('rm','-f',id);owned.delete(id);};
const own=(...args)=>{const id=docker('run','-d',...args);owned.add(id);return id;};
const handshake=container=>Number(docker('exec',container,'wg','show','wg-cloud','latest-handshakes').split(/\s+/)[1]);
const peerConfiguration=()=>docker('exec',peer,'wg','show','wg-cloud','allowed-ips')+'\n'+docker('exec',peer,'wg','show','wg-cloud','endpoints')+'\n'+docker('exec',peer,'wg','show','wg-cloud','persistent-keepalive');
const startGateway=()=>{
 const args=['--name',gateway,'--network',name,'--cap-add','NET_ADMIN',
  '-p',`127.0.0.1:${port??''}:443`,'-v',input+':/input:ro','-v',state+':/state',
  '-e','GATEWAY_CELL_ID='+cellId,'-e','GATEWAY_SUBNET=17'];
 if(ip)args.push('--ip',ip);const id=own(...args,image);
 port=Number(docker('port',gateway,'443/tcp').split(':').at(-1));
 ip=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',gateway);
 return id;
};
const startPeer=()=>own('--name',peer,'--network',name,'--cap-add','NET_ADMIN','-v',peerInput+':/input:ro',
 image,'sh','-c','node /input/upstream.mjs & exec node /app/src/peer-cli.ts');
let ca;
const httpsProbe=()=>new Promise((resolveProbe,reject)=>{
 const req=request({host:'127.0.0.1',port,servername:staffHostname,headers:{host:staffHostname},ca,agent:false},res=>{
  const fingerprint=res.socket.getPeerCertificate().fingerprint256;let body='';
  res.on('data',v=>body+=v);res.on('error',reject);res.on('end',()=>resolveProbe({status:res.statusCode,body,fingerprint}));
 });req.setTimeout(1000,()=>req.destroy(Error('probe timeout')));req.on('error',reject);req.end();
});
async function ping(){
 try{docker('exec',peer,'ping','-c','1','-W','1','10.77.17.1');return true;}catch{return false;}
}

try{
 console.log('Building an isolated local WireGuard/HAProxy image');
 run('docker','build','-q','-t',image,'-f','deploy/local-remote/Dockerfile','.');imageCreated=true;
 const imageId=docker('image','inspect','--format','{{.Id}}',image);
 docker('network','create',name);networkCreated=true;
 const kernel=docker('run','--rm','--network','none',image,'uname','-sr');
 for(const dir of [input,state,peerInput,join(input,'public-certs')])await mkdir(dir);
 for(const [prefix,hostname] of [['staff',staffHostname],['public',publicHostname]]){
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+hostname,
   '-addext','subjectAltName=DNS:'+hostname,'-keyout',join(root,prefix+'.key'),'-out',join(root,prefix+'.pem')],{stdio:'ignore'});
 }
 ca=await readFile(join(root,'staff.pem'));
 await secret(join(peerInput,'staff.key'),await readFile(join(root,'staff.key')));
 await secret(join(peerInput,'staff.pem'),ca);
 await secret(join(peerInput,'upstream.mjs'),`import {createServer} from 'node:https';import {readFileSync} from 'node:fs';createServer({key:readFileSync('/input/staff.key'),cert:readFileSync('/input/staff.pem')},(_req,res)=>{res.end(${JSON.stringify(marker)});}).listen(9443,'127.0.0.1');`);
 await secret(join(input,'public-certs/site.pem'),Buffer.concat([await readFile(join(root,'public.key')),await readFile(join(root,'public.pem'))]));
 await secret(join(input,'issuer.pem'),issuer.publicKey.export({type:'spki',format:'pem'}));
 await secret(join(input,'wireguard.key'),gatewayKey.privateKey);await secret(join(input,'bot.key'),randomBytes(32));
 const route={installationId:randomUUID(),venueId:randomUUID(),staffHostname,publicHostname,address:'10.77.17.2',port:443,peerPublicKey:peerKey.publicKey};
 for(const [pair,strategy] of [['traffic','control'],['traffic','peer-traffic'],['reset','control'],['reset','peer-reset']]){
  console.log('Starting '+pair+'/'+strategy);
  const now=Date.now();await secret(join(input,'manifest.json'),JSON.stringify(signManifest({version:1,audience:'waitron-cloud-gateway',cellId,sequence:++sequence,issuedAt:now,expiresAt:now+600000,routes:[route]},issuer.privateKey)));
  const oldGatewayId=startGateway();
  await secret(join(peerInput,'peer.json'),JSON.stringify({address:route.address,privateKey:peerKey.privateKey,
   gatewayPublicKey:gatewayKey.publicKey,gatewayEndpoint:ip+':51820',upstreamHost:'127.0.0.1',upstreamPort:9443}));
  const peerId=startPeer();
  const before=await waitFor(async()=>{const result=await httpsProbe();return result.status===200&&result.body===marker?result:false;});
  await waitFor(()=>Math.floor(Date.now()/1000)-handshake(peer)>=30,40000);
  const peerHandshakeBefore=handshake(peer),handshakeAgeSeconds=Math.floor(Date.now()/1000)-peerHandshakeBefore;
  assert.ok(handshakeAgeSeconds>=30&&handshakeAgeSeconds<=32);
  const priorConfiguration=peerConfiguration(),priorEndpoint=ip+':51820',priorKey=docker('exec',gateway,'wg','show','wg-cloud','public-key');
  const started=Date.now();remove(oldGatewayId);
  let failedRequests=0;
  await assert.rejects(httpsProbe());failedRequests++;
  await rm(join(state,'status.json'),{force:true});
  const replacementId=startGateway();
  await waitFor(async()=>JSON.parse(await readFile(join(state,'status.json'),'utf8')).ready&&docker('exec',gateway,'wg','show','wg-cloud','peers')===peerKey.publicKey);
  const gatewayReadyMs=Date.now()-started;
  const keyPreserved=docker('exec',gateway,'wg','show','wg-cloud','public-key')===priorKey;
  const endpointPreserved=ip+':51820'===priorEndpoint;
  assert.equal(handshake(gateway),0);
  // Gateway readiness does not establish that the peer can use its lost session.
  try{const response=await httpsProbe();assert.notEqual(response.status,200);failedRequests++;}catch(error){if(error.code==='ERR_ASSERTION')throw error;failedRequests++;}
  const actionStarted=Date.now();let trafficReply,peerResetApplied=false;
  if(strategy==='peer-traffic')trafficReply=await ping();
  if(strategy==='peer-reset'){
   docker('exec',peer,'wg','set','wg-cloud','peer',gatewayKey.publicKey,'remove');
   peerResetApplied=docker('exec',peer,'wg','show','wg-cloud','peers')==='';assert.equal(peerResetApplied,true);
   // Persistent keepalive can establish a fresh handshake immediately after re-addition.
   docker('exec',peer,'wg','set','wg-cloud','peer',gatewayKey.publicKey,'endpoint',priorEndpoint,
    'allowed-ips','10.77.17.1/32','persistent-keepalive','25');
   trafficReply=await ping();
  }
  const actionMs=Date.now()-actionStarted;
  const until=started+180000;let recovered,nextProgress=Date.now()+15000;
  while(Date.now()<until){
   try{const response=await httpsProbe();if(response.status===200&&response.body===marker){recovered=response;break;}}catch{}
   failedRequests++;await delay(500);
   if(Date.now()>=nextProgress){console.log(`${pair}/${strategy}: waiting ${Date.now()-started} ms for fresh HTTPS`);nextProgress=Date.now()+15000;}
  }
  assert.ok(recovered,'No HTTPS recovery within the 180-second experiment bound');
  const recoveryMs=Date.now()-started;
  const peerHandshakeAfter=handshake(peer),gatewayHandshakeAfter=handshake(gateway);
  assert.equal(peerConfiguration(),priorConfiguration);
  assert.equal(docker('inspect','--format','{{.Id}}',peer),peerId);
  // Session counters change during probes; configuration and the original process stay fixed.
  trials.push({pair,strategy,handshakeAgeSeconds,gatewayReadyMs,recoveryMs,actionMs,
   ...(trafficReply===undefined?{}:{trafficReply}),failedRequests,probeIntervalMs:500,
   gatewayReplaced:replacementId!==oldGatewayId,keyPreserved,endpointPreserved,
   peerUnchanged:!peerResetApplied,
   tlsFingerprintBefore:before.fingerprint,tlsFingerprintAfter:recovered.fingerprint,
   bodyMatched:recovered.body===marker,status:recovered.status,peerHandshakeBefore,peerHandshakeAfter,gatewayHandshakeAfter});
  console.log(`${pair}/${strategy}: recovered ${recoveryMs} ms (gateway ready ${gatewayReadyMs} ms)`);
  remove(peerId);remove(replacementId);
 }
 const environment={imageId,kernel,docker:docker('version','--format','{{.Server.Version}}')};
 await rm(root,{recursive:true,force:true});
 docker('network','rm',name);networkCreated=false;docker('image','rm',image);imageCreated=false;
 const cleanup={containersRemaining:Number(docker('ps','-a','-q','--filter','name='+name).split('\n').filter(Boolean).length),
  networkRemoved:!docker('network','ls','--filter','name=^'+name+'$','-q'),
  imageRemoved:!docker('image','ls','-q',image),temporaryFilesRemoved:await access(root).then(()=>false,()=>true)};
 const receipt={version:1,cloudHead,cloudDirty,liveResources:false,recordedAt:new Date().toISOString(),environment,trials,cleanup};
 verifyGatewayReconnectionReceipt(receipt);await writeFile(resolve(output),JSON.stringify(receipt,null,2)+'\n');
 console.log('PASS: paired gateway replacement measurements; all owned resources removed');
}finally{
 for(const id of owned)docker('rm','-f',id);
 if(networkCreated)docker('network','rm',name);
 if(imageCreated)docker('image','rm',image);
 await rm(root,{recursive:true,force:true});
}
