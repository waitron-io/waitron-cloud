// Fixture state stays in the disposable project's private volume; stdout contains public facts only.
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:https';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {loadRuntime} from '../../local-stack/runtime.mjs';
import {OrganisationPlanStore,encodeMachine,createLeaseIssuer} from '../../../packages/registration/src/index.ts';
import {RemoteAccessStore} from '../../../packages/remote-access/src/placement.ts';
const {Pool}=createRequire(new URL('../../../packages/registration/package.json',import.meta.url))('pg');
const directory='/run/local-stack',root=directory+'/remote-proof',origin='https://waitron.local:3000';
const wireguard=()=>{const keys=generateKeyPairSync('x25519');return {privateKey:keys.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64'),publicKey:keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')};};
export async function remoteClientProof(phase,gatewayIp){
 const config=await loadRuntime(directory),pool=new Pool({connectionString:`postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`,connectionTimeoutMillis:5000,statement_timeout:10000});
 const ca=await readFile(directory+'/lan/ca.pem'),issuer=createLeaseIssuer(config.installation.issuerKey),plans=new OrganisationPlanStore(pool),store=new RemoteAccessStore(pool,'test-free-paid');
 async function machine(item,action,body){
  const lease=issuer.issue({origin,leaseId:randomUUID(),installationId:item.installationId,venueId:item.venueId,environment:'test',publicKey:item.publicKey,issuedAt:Date.now(),expiresAt:Date.now()+3600000});
  const bytes=encodeMachine({origin,action,installationId:item.installationId,operationId:randomUUID(),issuedAt:Date.now(),lease:JSON.stringify(lease),body:JSON.stringify(body)}),encoded=JSON.stringify({payload:bytes.toString('base64url'),signature:sign(null,bytes,item.privateKey).toString('base64url')});
  return new Promise((resolve,reject)=>{const req=request({hostname:'proxy',port:3000,servername:'waitron.local',ca,path:'/api/installations/'+action,method:'POST',headers:{host:'waitron.local:3000','content-type':'application/json','content-length':Buffer.byteLength(encoded)}},res=>{let text='';res.on('data',value=>text+=value);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});});req.setTimeout(5000,()=>req.destroy(Error('remote proof account timeout')));req.once('error',reject);req.end(encoded);});
 }
 const stateFile=join(root,'state.json');
 try{
  if(phase==='seed'){
   await mkdir(root,{mode:0o700});const venues=[];
   for(let n=0;n<2;n++){
    const key=generateKeyPairSync('ed25519'),item={organisationId:randomUUID(),business:randomUUID(),venueId:randomUUID(),installationId:randomUUID(),privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peer:wireguard()};
    await pool.query('INSERT INTO organisations(id) VALUES($1)',[item.organisationId]);await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[item.business,item.organisationId]);await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[item.venueId,item.organisationId,item.business,randomUUID()]);await pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[item.installationId,item.venueId,item.publicKey]);await pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access')",[item.installationId]);
    await assert.rejects(store.provision(item.installationId,config.gateway.cellId,item.peer.publicKey),/permission_denied/);
    await plans.set(item.organisationId,'paid');item.placement=await store.provision(item.installationId,config.gateway.cellId,item.peer.publicKey);
    const peerDir=join(root,'peer-'+n);await mkdir(peerDir,{mode:0o700});
    execFileSync('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',join(peerDir,'staff.key'),'-out',join(peerDir,'staff.csr'),'-subj','/CN='+item.placement.staffHostname,'-addext','subjectAltName=DNS:'+item.placement.staffHostname],{stdio:'ignore'});
    const csr=await readFile(join(peerDir,'staff.csr'),'utf8'),revision=Number((await pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[item.installationId])).rows[0].configuration_revision);
    const submitted=await machine(item,'staff-certificate-submit',{version:1,hostname:item.placement.staffHostname,revision,csr,previousRequestId:null});assert.equal(submitted.status,200,JSON.stringify(submitted.body));item.requestId=submitted.body.requestId;
    let ready;for(let attempt=0;attempt<120;attempt++){ready=await machine(item,'staff-certificate-status',{version:1,requestId:item.requestId});if(ready.body.state==='ready')break;await delay(250);}assert.equal(ready.body.state,'ready',JSON.stringify(ready.body));
    await writeFile(join(peerDir,'staff.pem'),ready.body.certificate,{mode:0o600});
    await writeFile(join(peerDir,'peer.json'),JSON.stringify({address:item.placement.address,privateKey:item.peer.privateKey,gatewayPublicKey:item.placement.gatewayPublicKey,gatewayEndpoint:gatewayIp+':51820',upstreamHost:'127.0.0.1',upstreamPort:9443}),{mode:0o600});
    await writeFile(join(peerDir,'upstream.mjs'),`import {createServer} from 'node:https';import {readFileSync} from 'node:fs';createServer({key:readFileSync('/input/staff.key'),cert:readFileSync('/input/staff.pem')},(_req,res)=>res.end('venue-${n}')).listen(9443,'127.0.0.1');`,{mode:0o600});
    venues.push(item);
   }
   await writeFile(stateFile,JSON.stringify(venues),{mode:0o600});console.log(JSON.stringify({phase,freeProvision:403,signedStaffCertificates:200,venues:venues.map(v=>({installationId:v.installationId,...v.placement}))}));
  }else{
   const venues=JSON.parse(await readFile(stateFile,'utf8'));
   if(phase==='renew-public'){
    await writeFile(join(directory,'remote',venues[1].installationId,'certificate.pem'),'invalidated local fixture certificate',{mode:0o600});
    await pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE target_id=$1 AND kind='certificate_public'",[venues[1].installationId]);
    console.log(JSON.stringify({phase,scheduled:true}));return;
   }
   if(phase==='downgrade'||phase==='downgrade-pending')await plans.set(venues[0].organisationId,'free');
   else if(phase==='upgrade'){
    await plans.set(venues[0].organisationId,'paid');await store.provision(venues[0].installationId,config.gateway.cellId,venues[0].peer.publicKey);
   }else throw Error('remote proof phase');
   if(phase!=='upgrade'){const result=await machine(venues[0],'staff-certificate-status',{version:1,requestId:venues[0].requestId});assert.equal(result.status,403);assert.equal(result.body.error,'permission_denied');}
   console.log(JSON.stringify({phase,committed:true}));
  }
 }finally{await pool.end();}
}
