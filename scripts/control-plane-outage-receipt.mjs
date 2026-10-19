import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {database} from '../packages/account-http/test/fixtures.ts';
import {SignupStore,RegistrationStore,createLeaseIssuer,encodeMachine} from '../packages/registration/src/index.ts';
import {RemoteAccessStore} from '../packages/remote-access/src/placement.ts';
import {GatewayAuthority} from '../packages/remote-access/src/authority.ts';
import {signManifest} from '../packages/remote-access/src/manifest.ts';
import {startBackupStorage} from './backup-storage-fixture.mjs';

const require=createRequire(new URL('../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
const output=process.argv[2]??'/tmp/cloud-control-plane-outage-receipt.json';
const oldIssuerKey=generateKeyPairSync('ed25519'),newIssuerKey=generateKeyPairSync('ed25519');
const oldIssuer=createLeaseIssuer(oldIssuerKey.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const newIssuer=createLeaseIssuer(newIssuerKey.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const installationKey=generateKeyPairSync('ed25519'),gatewaySigningKey=generateKeyPairSync('ed25519');
let db,storage,routeServer,account;

async function freePort(){const server=createNetServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert(address&&typeof address!=='string');await new Promise(resolve=>server.close(resolve));return address.port;}
async function until(check,timeout=10000){const deadline=Date.now()+timeout;while(!await check()){if(Date.now()>=deadline)throw Error('condition timed out');await delay(20);}}

try{
  db=await database();
  const accountPort=await freePort(),origin=`http://127.0.0.1:${accountPort}`;
  const signup=new SignupStore(db.pool,db.outbox);await signup.request('outage-owner@example.test');
  const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password:'A long enough outage proof password',organisationName:'Outage proof',legalBusinessName:'Outage Proof SL',countryCode:'ES'});
  const registration=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:installationKey.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());
  const connected=await registration.complete(binding);

  const placementStore=new RemoteAccessStore(db.pool),cellId=randomUUID();
  await placementStore.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'outage.example.test',subnet:41,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.outage.example.test:51820'});
  await placementStore.provision(connected.installationId,cellId,randomBytes(32).toString('base64'));
  let cachedManifest,gateway,routeExpiresAt;
  const gatewayHooks={persist:async envelope=>{cachedManifest=envelope;},apply:async()=>{},close:async()=>{}};
  gateway=new GatewayAuthority(gatewaySigningKey.publicKey,cellId,gatewayHooks);
  routeServer=createServer((_request,response)=>{response.statusCode=gateway.routes.some(route=>route.installationId===connected.installationId)?200:503;response.end();});
  await new Promise((resolve,reject)=>{routeServer.once('error',reject);routeServer.listen(0,'127.0.0.1',()=>{routeServer.removeListener('error',reject);resolve();});});
  const routeAddress=routeServer.address();assert(routeAddress&&typeof routeAddress!=='string');
  const routeStatus=async()=>{const response=await fetch(`http://127.0.0.1:${routeAddress.port}/route`);return response.status;};
  storage=await startBackupStorage({tokenDuration:'12s'});const location=await storage.bucket('control-plane-outage');
  const storageGrant=await storage.authority.grant(location,{kind:'capture',bucket:location.bucket,scope:'incoming/outage'},storage.ca);
  const storageClient=new S3Client({endpoint:location.endpoint,region:location.region,forcePathStyle:true,credentials:storageGrant.credentials,maxAttempts:1,requestHandler:{httpsAgent:storage.agent()}});

  const databaseUrl=new URL(process.env.TEST_DATABASE_URL);databaseUrl.searchParams.set('options',`-c search_path=${db.schema}`);
  function startAccount(issuer,trusted=[]){
    const child=spawn(process.execPath,[new URL('../packages/account-http/src/server-cli.ts',import.meta.url).pathname],{env:{...process.env,DATABASE_URL:databaseUrl.href,CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_HTTP_RATE_KEY:db.rateKey,CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_PORT:String(accountPort),CLOUD_HTTP_HOST:'127.0.0.1',CLOUD_HTTP_TRUSTED_PROXY_IPS:'',CLOUD_INSTALLATION_ISSUER_KEY:issuer===oldIssuer?oldIssuerKey.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'):newIssuerKey.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'),CLOUD_INSTALLATION_TRUSTED_KEYS:JSON.stringify(trusted),NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    const exited=once(child,'exit').then(([code,signal])=>({code,signal,stdout,stderr}));
    return {child,exited,async ready(){await until(async()=>stdout.includes('\n')||child.exitCode!==null);assert.equal(child.exitCode,null,stderr);assert.equal(JSON.parse(stdout.trim()).port,accountPort);},async stop(){if(child.exitCode===null)child.kill('SIGTERM');const result=await exited;assert.equal(result.code,0,result.stderr);return result;}};
  }
  function proof(action,lease='',body={},operationId=randomUUID()){
    const bytes=encodeMachine({origin,action,installationId:connected.installationId,operationId,issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:JSON.stringify(body)});
    return {payload:bytes.toString('base64url'),signature:sign(null,bytes,installationKey.privateKey).toString('base64url')};
  }
  async function machine(action,envelope){return fetch(`${origin}/api/installations/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope),signal:AbortSignal.timeout(5000)});}

  account=startAccount(oldIssuer);await account.ready();
  // Start the short route clock after slow fixture setup so it measures only the outage/restart path.
  const initial=await placementStore.manifest(cellId);routeExpiresAt=Date.now()+5000;
  initial.issuedAt=Date.now();initial.expiresAt=routeExpiresAt;await gateway.accept(signManifest(initial,gatewaySigningKey.privateKey));
  assert.equal(await routeStatus(),200);const availableBeforeOutage=true;
  const outageStarted=Date.now();await account.stop();account=undefined;
  let connectionRefusedDuringOutage=false;try{await fetch(`${origin}/api/account/session`,{signal:AbortSignal.timeout(1000)});}catch{connectionRefusedDuringOutage=true;}assert.equal(connectionRefusedDuringOutage,true);
  assert.equal(await routeStatus(),200);const availableDuringOutage=true;
  await storageClient.send(new PutObjectCommand({Bucket:location.bucket,Key:'incoming/outage',Body:'stored while account API was stopped'}));const availableStorageDuringOutage=true;
  gateway=new GatewayAuthority(gatewaySigningKey.publicKey,cellId,gatewayHooks);await gateway.restore(cachedManifest);assert.equal(await routeStatus(),200);const cachedRestartAvailable=true;

  const oldLeaseIssuedAt=Date.now(),oldLeaseExpiresAt=oldLeaseIssuedAt+5000;
  const oldLease=oldIssuer.issue({origin,leaseId:randomUUID(),installationId:connected.installationId,venueId:connected.venueId,environment:'test',publicKey:binding.installationKey,issuedAt:oldLeaseIssuedAt,expiresAt:oldLeaseExpiresAt});
  account=startAccount(newIssuer,[oldIssuer.publicKey]);await account.ready();const outageMs=Date.now()-outageStarted;
  let response=await machine('configuration',proof('configuration',oldLease));assert.equal(response.status,200,await response.clone().text());const oldLeaseAcceptedDuringOverlap=true;
  response=await machine('renew',proof('renew'));assert.equal(response.status,200,await response.clone().text());const renewed=await response.json(),newLease=renewed.lease;
  const newLeaseSignedByNewKey=JSON.parse(Buffer.from(newLease.payload,'base64url').toString())[2]===newIssuer.keyId;assert.equal(newLeaseSignedByNewKey,true);

  while(Date.now()<=routeExpiresAt)await delay(Math.min(250,routeExpiresAt+1-Date.now()));assert.equal(await routeStatus(),503);const refusedAtSignedExpiry=true;await gateway.tick();
  while(Date.now()<=oldLeaseExpiresAt)await delay(Math.min(250,oldLeaseExpiresAt+1-Date.now()));const oldLeaseExpiredBeforeRemoval=true;
  // This fresh old-key lease is a negative control. A 401 proves key removal rather than expiry.
  const liveOldLeaseIssuedAt=Date.now();
  const liveOldLease=oldIssuer.issue({origin,leaseId:randomUUID(),installationId:connected.installationId,venueId:connected.venueId,environment:'test',publicKey:binding.installationKey,issuedAt:liveOldLeaseIssuedAt,expiresAt:liveOldLeaseIssuedAt+3600000});
  await account.stop();account=startAccount(newIssuer);await account.ready();
  response=await machine('configuration',proof('configuration',oldLease));assert.equal(response.status,401);const expiredOldLeaseRefusedAfterRemoval=true;
  response=await machine('configuration',proof('configuration',liveOldLease));assert.equal(response.status,401);const liveOldIssuerNegativeControlRefusedAfterRemoval=true;
  response=await machine('configuration',proof('configuration',newLease));assert.equal(response.status,200,await response.clone().text());const recoveredAfterRestart=true;

  const recoveredManifest=await placementStore.manifest(cellId);await gateway.accept(signManifest(recoveredManifest,gatewaySigningKey.privateKey));assert.equal(await routeStatus(),200);const availableAfterControlRecovery=true;
  while(Date.now()<=Date.parse(storageGrant.expiresAt)+1000)await delay(Math.min(500,Date.parse(storageGrant.expiresAt)+1001-Date.now()));
  await assert.rejects(storageClient.send(new PutObjectCommand({Bucket:location.bucket,Key:'incoming/expired',Body:'must fail'})),error=>error?.$metadata?.httpStatusCode===403);const refusedAfterCredentialExpiry=true;

  response=await machine('revoke',proof('revoke'));assert.equal(response.status,200,await response.clone().text());
  response=await machine('configuration',proof('configuration',newLease));assert.equal(response.status,403);const revokedLeaseRefused=true;
  const revokedManifest=await placementStore.manifest(cellId);await gateway.accept(signManifest(revokedManifest,gatewaySigningKey.privateKey));assert.equal(await routeStatus(),503);const revokedAfterRefresh=true;

  const receipt={schemaVersion:1,cloudHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cloudDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',measuredAt:new Date().toISOString(),environment:{accountServerProcess:true,gatewaySocket:true,storageTls:true,storageProvider:'SeaweedFS 4.47'},controlPlane:{connectionRefusedDuringOutage,recoveredAfterRestart,outageMs},route:{availableBeforeOutage,availableDuringOutage,cachedRestartAvailable,refusedAtSignedExpiry,availableAfterControlRecovery,revokedAfterRefresh},storage:{availableDuringOutage:availableStorageDuringOutage,refusedAfterCredentialExpiry,credentialExpiresAt:storageGrant.expiresAt},rotation:{oldKeyId:oldIssuer.keyId,newKeyId:newIssuer.keyId,oldLeaseAcceptedDuringOverlap,newLeaseSignedByNewKey,oldLeaseExpiredBeforeRemoval,expiredOldLeaseRefusedAfterRemoval,liveOldIssuerNegativeControlRefusedAfterRemoval,revokedLeaseRefused}};
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({output,...receipt}));
}finally{
  if(account?.child.exitCode===null)await account.stop().catch(()=>{});
  if(routeServer)await new Promise(resolve=>routeServer.close(resolve));
  await storage?.stop();await db?.close();
}
