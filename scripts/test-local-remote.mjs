import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomUUID,randomBytes,X509Certificate} from 'node:crypto';
import {request} from 'node:https';
import {connect as tlsConnect} from 'node:tls';
import {setTimeout as delay} from 'node:timers/promises';
import {startPortalFixture} from '../apps/portal/test/fixtures.ts';
import {SignupStore,PairingStore,InstallationStore,MonitorWorker} from '../packages/registration/src/index.ts';
import {login} from '../packages/identity/src/index.ts';
import {transaction} from '../packages/registration/src/transaction.ts';
import {RemoteAccessStore} from '../packages/remote-access/src/placement.ts';
import {RemoteProbeStore} from '../packages/remote-access/src/probe-targets.ts';
import {RemoteProbeObservationStore} from '../packages/remote-access/src/probe-observations.ts';
import {probeTarget} from '../packages/remote-access/src/probe.ts';
import {signManifest} from '../packages/remote-access/src/manifest.ts';
import {startAcme,docker,waitFor} from './remote-fixtures.mjs';
const waitron=resolve(process.env.WAITRON_CHECKOUT??'');
assert.ok(process.env.WAITRON_CHECKOUT,'Set WAITRON_CHECKOUT');
const require=createRequire(join(waitron,'apps/server/package.json'));
const acmeRequire=createRequire(new URL('../packages/remote-access/package.json',import.meta.url));
const {crypto:acmeCrypto}=acmeRequire('acme-client');
const root=await mkdtemp(join(tmpdir(),'cloud-remote-')),name='cloud-remote-'+randomUUID();
const owned=new Set(),children=[],roots=[],checks=[];
let f,acme,network=false,gatewayPort,gatewayIp,targetGatewayPort,targetGatewayIp;
const cellId=randomUUID(),targetCellId=randomUUID(),issuer=generateKeyPairSync('ed25519');
const wgKey=()=>{const key=generateKeyPairSync('x25519');return {privateKey:key.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64'),publicKey:key.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')};};
const gatewayKey=wgKey(),targetGatewayKey=wgKey();
checks.push=(...values)=>{for(const value of values)console.log('PASS:',value);return Array.prototype.push.apply(checks,values);};
const input=join(root,'input'),state=join(root,'state'),targetInput=join(root,'target-input'),targetState=join(root,'target-state');
async function launch(venueRoot){
 await rm(join(venueRoot,'ready.json'),{force:true});
 const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(waitron,'apps/server/scripts/cloud-integration-fixture.ts')],{cwd:join(waitron,'apps/server'),env:{...process.env,CLOUD_TEST_ROOT:venueRoot,CLOUD_TEST_ORIGIN:f.origin,CLOUD_TEST_EXTERNAL:'1'},stdio:['ignore','pipe','pipe','ipc']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',v=>output=(output+v).slice(-16000));
 const running={child,done:new Promise(resolve=>child.once('exit',resolve))};children.push(running);
 return waitFor(async()=>{if(child.exitCode!==null)throw Error(output);try{return {...running,...JSON.parse(await readFile(join(venueRoot,'ready.json'),'utf8'))};}catch(error){if(error.code==='ENOENT')return false;throw error;}},30000);
}
async function stop(running){if(running.child.exitCode!==null)return;running.child.kill('SIGTERM');const timeout=setTimeout(()=>running.child.kill('SIGKILL'),5000);try{assert.equal(await running.done,0);}finally{clearTimeout(timeout);}}
function ipc(server,value){return new Promise((resolve,reject)=>{const reply=value=>{clearTimeout(timer);if(value.error)reject(Error(value.error));else resolve(value);};const timer=setTimeout(()=>{server.child.off('message',reply);reject(Error('IPC timeout'));},10000);server.child.once('message',reply);server.child.send(value);});}
async function secret(path,value){await writeFile(path,value,{mode:0o600});}
async function publish(manifest){await secret(join(input,'manifest.new'),JSON.stringify(signManifest(manifest,issuer.privateKey)));await rename(join(input,'manifest.new'),join(input,'manifest.json'));}
async function publishTarget(manifest){await secret(join(targetInput,'manifest.new'),JSON.stringify(signManifest(manifest,issuer.privateKey)));await rename(join(targetInput,'manifest.new'),join(targetInput,'manifest.json'));}
function startGateway(){
 const args=['run','-d','--name',name+'-gateway','--network',name,'--cap-add','NET_ADMIN','--sysctl','net.ipv4.ip_forward=1','-p',`127.0.0.1:${gatewayPort??''}:443`,'-v',input+':/input:ro','-v',state+':/state','-e','GATEWAY_CELL_ID='+cellId,'-e','GATEWAY_SUBNET=17','-e','GATEWAY_UPSTREAM_CA=/input/venue-ca.pem'];
 if(gatewayIp)args.push('--ip',gatewayIp);
 docker(...args,'waitron-cloud-local-remote:dev');owned.add(name+'-gateway');
 gatewayPort=Number(docker('port',name+'-gateway','443/tcp').split(':').at(-1));gatewayIp=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name+'-gateway');
}
function startTargetGateway(){
 const args=['run','-d','--name',name+'-gateway-target','--network',name,'--cap-add','NET_ADMIN','--sysctl','net.ipv4.ip_forward=1','-p',`127.0.0.1:${targetGatewayPort??''}:443`,'-v',targetInput+':/input:ro','-v',targetState+':/state','-e','GATEWAY_CELL_ID='+targetCellId,'-e','GATEWAY_SUBNET=18','-e','GATEWAY_UPSTREAM_CA=/input/venue-ca.pem'];
 if(targetGatewayIp)args.push('--ip',targetGatewayIp);
 docker(...args,'waitron-cloud-local-remote:dev');owned.add(name+'-gateway-target');
 targetGatewayPort=Number(docker('port',name+'-gateway-target','443/tcp').split(':').at(-1));targetGatewayIp=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name+'-gateway-target');
}
function startPeer(venue,index){
 const peer=name+`-peer-${index}`;docker('run','-d','--name',peer,'--network',name,'--cap-add','NET_ADMIN','-v',venue.peerInput+':/input:ro','waitron-cloud-local-remote:dev','node','/app/src/peer-cli.ts');owned.add(peer);venue.peer=peer;
}
function remoteAt(port,host,path='/public/availability',options={}){
 return new Promise((resolve,reject)=>{
  const body=options.body===undefined?undefined:JSON.stringify(options.body);
  const req=request({host:'127.0.0.1',port,servername:host,ca:acme.certificateRoot,agent:false,path,method:options.method??(body?'POST':'GET'),headers:{Host:host,...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}),...options.headers}},res=>{let text='';res.on('data',v=>text+=v);res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,certificate:res.socket?.getPeerCertificate?.().fingerprint256}));});
  req.setTimeout(4000,()=>req.destroy(Error('request timeout')));req.on('error',reject);req.end(body);
 });
}
const remote=(host,path,options)=>remoteAt(gatewayPort,host,path,options);
const remoteTarget=(host,path,options)=>remoteAt(targetGatewayPort,host,path,options);
async function solve(host,transport=remote){
 const reply=await transport(host,'/_cloud/challenge');assert.equal(reply.status,200,reply.text);const challenge=JSON.parse(reply.text);
 const worker=await transport(host,'/_cloud/worker.js');assert.equal(worker.status,200);
 const page=await f.browser.newPage();await page.route(f.origin+'/worker-proof',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Worker proof</title>'}));await page.goto(f.origin+'/worker-proof');
 const proof=await page.evaluate(({source,challenge})=>new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob([source],{type:'application/javascript'})),worker=new Worker(url);const timer=setTimeout(()=>{worker.terminate();URL.revokeObjectURL(url);reject(Error('worker timeout'));},30000);worker.onerror=error=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);reject(Error(error.message));};worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);resolve(data);};worker.postMessage(challenge);}),{source:worker.text,challenge});await page.close();
 const answer=await transport(host,'/_cloud/solve',{body:proof});assert.equal(answer.status,204);return answer.headers['set-cookie'][0].split(';')[0];
}
try{
 await mkdir(input);await mkdir(state);await mkdir(join(input,'public-certs'));await mkdir(targetInput);await mkdir(targetState);await mkdir(join(targetInput,'public-certs'));
 f=await startPortalFixture();acme=await startAcme();
 const signup=new SignupStore(f.db.pool,f.db.outbox),email=`remote-${randomUUID()}@example.test`,password='Local remote integration password';
 await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);
 const owner=await signup.complete(mail.token,{password,organisationName:'Remote test',legalBusinessName:'Remote test SL',countryCode:'ES'});
 const session=await transaction(f.db.pool,client=>login(client,{email,password}));
 const databaseUrl=new URL(process.env.TEST_DATABASE_URL);databaseUrl.searchParams.set('options','-c search_path='+f.db.schema);
 const operator=async(command,value)=>{const file=join(root,'operator-'+randomUUID()+'.json');await secret(file,JSON.stringify(value));return execFileSync(process.execPath,['packages/remote-access/src/operator-cli.ts',command,file],{encoding:'utf8',env:{...process.env,DATABASE_URL:databaseUrl.toString()}}).trim();};
 const placementStore=new RemoteAccessStore(f.db.pool),installations=new InstallationStore(f.db.pool,f.issuer,f.origin);
 await operator('cell',{id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'remote.example.test',subnet:17,publicKey:gatewayKey.publicKey,endpoint:'gateway.example.test:51820'});
 await operator('cell',{id:targetCellId,country:'ES',provider:'aws',environment:'test',suffix:'target.remote.example.test',subnet:18,publicKey:targetGatewayKey.publicKey,endpoint:'target-gateway.example.test:51820'});
 const accountKeyFile=join(root,'account.key');await secret(accountKeyFile,await acmeCrypto.createPrivateKey());
 const venues=[];
 for(let n=0;n<2;n++){
  const venueRoot=await mkdtemp(join(tmpdir(),'cloud-integration-'));roots.push(venueRoot);let server=await launch(venueRoot);
  const context=await f.browser.newContext();const post=async(path,data={})=>{const result=await context.request.post(server.origin+path,{headers:{origin:server.origin},data});assert.equal(result.status(),200,await result.text());return result.json();};
  await post('/management-api/session',{email:'owner@example.test',password:'Local integration password'});
  const pairing=await post('/management-api/cloud/start');
  await new PairingStore(f.db.pool).approve(pairing.requestId,pairing.code,owner.organisationId,owner.legalBusinessId,session.token,session.csrfToken);
  await post('/management-api/cloud/check');
  const paired=await post('/management-api/cloud/complete',{requestId:pairing.requestId,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId});
  const key=wgKey(),placement=JSON.parse(await operator('provision',{installationId:paired.registration.installationId,cellId,peerPublicKey:key.publicKey}));
  const csr=(await ipc(server,{csrHostname:placement.staffHostname})).csr;
  const csrFile=join(root,`venue-${n}.csr`);await secret(csrFile,csr);
  const certificate=await acme.issue({operator:{databaseUrl:databaseUrl.toString(),installationId:placement.installationId,kind:'staff'},hostname:placement.staffHostname,csrFile,accountKeyFile,output:join(root,`venue-${n}.crt`)});
  await ipc(server,{certificate,hostname:placement.staffHostname});await stop(server);server=await launch(venueRoot);
  const [publicKey,publicCsr]=await acmeCrypto.createCsr({commonName:placement.publicHostname,altNames:[placement.publicHostname]});
  const publicCsrFile=join(root,`public-${n}.csr`);await secret(publicCsrFile,publicCsr);
  const publicCertificate=await acme.issue({operator:{databaseUrl:databaseUrl.toString(),installationId:placement.installationId,kind:'public'},hostname:placement.publicHostname,csrFile:publicCsrFile,accountKeyFile,output:join(root,`public-${n}.crt`)});
  const publicMaterial=Buffer.concat([publicKey,Buffer.from(publicCertificate)]);await secret(join(input,'public-certs',`venue-${n}.pem`),publicMaterial);await secret(join(targetInput,'public-certs',`venue-${n}.pem`),publicMaterial);
  venues.push({root:venueRoot,server,key,placement,certificate});await context.close();
 }
 checks.push('two real SQLite Waitron servers paired through authenticated manager APIs');
 await secret(join(input,'issuer.pem'),issuer.publicKey.export({type:'spki',format:'pem'}));await secret(join(input,'wireguard.key'),gatewayKey.privateKey);await secret(join(input,'bot.key'),randomBytes(32));await secret(join(input,'venue-ca.pem'),acme.certificateRoot);
 await secret(join(targetInput,'issuer.pem'),issuer.publicKey.export({type:'spki',format:'pem'}));await secret(join(targetInput,'wireguard.key'),targetGatewayKey.privateKey);await secret(join(targetInput,'bot.key'),randomBytes(32));await secret(join(targetInput,'venue-ca.pem'),acme.certificateRoot);
 const signingKeyFile=join(root,'issuer.key');await secret(signingKeyFile,issuer.privateKey.export({format:'pem',type:'pkcs8'}));await operator('export',{cellId,signingKeyFile,output:join(input,'manifest.json')});docker('network','create',name);network=true;startGateway();
 for(const [n,venue] of venues.entries()){
  const peerInput=join(root,`peer-${n}`);await mkdir(peerInput);await secret(join(peerInput,'peer.json'),JSON.stringify({address:venue.placement.address,privateKey:venue.key.privateKey,gatewayPublicKey:gatewayKey.publicKey,gatewayEndpoint:gatewayIp+':51820',upstreamHost:'host.docker.internal',upstreamPort:venue.server.port}));venue.peerInput=peerInput;
  await secret(join(peerInput,'ca.pem'),acme.certificateRoot);
  startPeer(venue,n);
 }
 await waitFor(async()=>{for(const venue of venues)if((await remote(venue.placement.staffHostname)).status!==200)return false;return true;});
 for(const venue of venues){const privateKey=await readFile(join(venue.root,'cloud-staff.key'),'utf8');const mounted=docker('exec',name+'-gateway','sh','-c','cat /input/public-certs/*.pem /state/* /input/* 2>/dev/null || true');assert.equal(mounted.includes(privateKey),false);}
 checks.push('real WireGuard traffic and staff TLS passthrough; venue TLS keys absent from gateway');
 const cookies=[];
 for(const venue of venues){
  const host=venue.placement.staffHostname;
  const signed=await remote(host,'/management-api/session',{body:{email:'owner@example.test',password:'Local integration password'},headers:{origin:'https://'+host}});assert.equal(signed.status,200,signed.text);cookies.push(signed.headers['set-cookie'].map(v=>v.split(';')[0]).join('; '));
 }
 assert.equal((await remote(venues[1].placement.staffHostname,'/management-api/cloud/status',{headers:{cookie:cookies[0]}})).status,401);
 await assert.rejects(remote('unknown.remote.example.test'));
 checks.push('venue A manager cookie refused by B; unknown SNI refused');
 const publicHost=venues[0].placement.publicHostname;
 assert.equal((await remote(publicHost)).status,403);assert.equal((await remote(publicHost,'/management-api/session')).status,404);
 assert.equal((await remote(publicHost,'/public/availability',{headers:{host:venues[1].placement.publicHostname,'X-Waitron-Client-IP':'127.0.0.2','X-Waitron-SNI':venues[1].placement.publicHostname}})).status,421);
 await delay(1200);assert.equal(JSON.parse(await readFile(join(state,'status.json'),'utf8')).forwarded,0);
 const cookie=await solve(publicHost);assert.equal((await remote(publicHost,'/public/availability',{headers:{cookie}})).status,200);
 assert.equal((await remote(venues[1].placement.publicHostname,'/public/availability',{headers:{cookie}})).status,403);
 checks.push('real browser Worker proof of work, rejected public calls have zero upstream requests, blocked manager paths, overwritten proxy headers, cross-host bot cookie refusal');
 // A compromised peer can broaden its own routes; the gateway still refuses venue-to-venue forwarding.
 docker('exec',venues[0].peer,'wg','set','wg-cloud','peer',gatewayKey.publicKey,'allowed-ips','10.77.17.0/24');docker('exec',venues[0].peer,'ip','route','add',venues[1].placement.address+'/32','dev','wg-cloud');
 const isolation=docker('exec',venues[0].peer,'node','-e',`const s=require('net').connect(443,'${venues[1].placement.address}');s.on('connect',()=>process.exit(1));s.on('error',()=>process.exit(0));setTimeout(()=>{s.destroy();process.exit(0)},1500);`);assert.equal(isolation,'');
 const firewall=docker('exec',name+'-gateway','iptables','-L','FORWARD','-v','-n');assert.match(firewall,/policy DROP [1-9]\d* packets/);
 checks.push('malicious peer route expansion cannot reach another venue; gateway DROP counter increased');
 // Renew at the venue, then verify a fresh connection sees the new certificate without a restart.
 const renewing=venues[1],csrFile=join(root,'renew.csr');await secret(csrFile,(await ipc(renewing.server,{csrHostname:renewing.placement.staffHostname})).csr);
 const renewed=await acme.issue({operator:{databaseUrl:databaseUrl.toString(),installationId:renewing.placement.installationId,kind:'staff'},hostname:renewing.placement.staffHostname,csrFile,accountKeyFile,output:join(root,'renew.crt')});assert.notEqual(new X509Certificate(renewed).serialNumber,new X509Certificate(renewing.certificate).serialNumber);
 await ipc(renewing.server,{certificate:renewed,hostname:renewing.placement.staffHostname});
 const fingerprint=()=>new Promise((resolve,reject)=>{const socket=tlsConnect({host:'127.0.0.1',port:gatewayPort,servername:renewing.placement.staffHostname,ca:acme.certificateRoot},()=>{const value=socket.getPeerCertificate().fingerprint256;socket.end();resolve(value);});socket.on('error',reject);socket.setTimeout(3000,()=>socket.destroy(Error('TLS timeout')));});
 await waitFor(async()=>{await delay(1000);return await fingerprint()===new X509Certificate(renewed).fingerprint256;},20000);checks.push('real ACME renewal hot-reloaded by running Waitron');
 const probeTargets=await new RemoteProbeStore(f.db.pool).targets();assert.equal(probeTargets.length,2);
 const fixtureConnections=new Map(probeTargets.flatMap(target=>[target.publicHostname,target.staffHostname].map(hostname=>[hostname,{address:'127.0.0.1',family:4,port:gatewayPort}]))),fixtureConnect=hostname=>{const connection=fixtureConnections.get(hostname);if(!connection)throw Error('fixture_host_unavailable');return connection;};
 const functionalProbes=await Promise.all(probeTargets.map(target=>probeTarget(target,{ca:acme.certificateRoot,connect:fixtureConnect})));
 for(const [index,result] of functionalProbes.entries()){assert.equal(result.version,1);assert.equal(result.installationId,probeTargets[index].installationId);assert.equal(result.venueId,probeTargets[index].venueId);assert.equal(result.revision,probeTargets[index].revision);for(const service of [result.public,result.staff]){assert.equal(service.status,'healthy');if(service.status==='healthy'){assert.match(service.certificate.notAfter,/Z$/);assert.match(service.certificate.fingerprint256,/^[0-9A-F:]+$/);}}}
 const unknown='unknown.remote.example.test',rejectedProbe=await probeTarget({...probeTargets[0],publicHostname:unknown},{ca:acme.certificateRoot,connect:hostname=>({address:'127.0.0.1',family:4,port:gatewayPort})});assert.equal(rejectedProbe.public.status,'failed');
 checks.push('Cloud functional probes solve the real public challenge and verify staff TLS for two isolated placements; unknown SNI is refused');
 for(const [index,venue] of venues.entries()){const view=(await f.db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[venue.placement.installationId])).rows[0];await installations.configure(venue.placement.installationId,Number(view.configuration_revision),[{service:'remote_access',state:'ready',configuration:{version:1,...venue.placement}}]);assert.equal((await remote(venue.placement.staffHostname,'/management-api/cloud/refresh',{body:{},headers:{cookie:cookies[index],origin:'https://'+venue.placement.staffHostname}})).status,200);const report=await ipc(venue.server,{report:[{service:'remote_access',health:'healthy',failure:null}]});assert.equal(report.status.installation.services.find(s=>s.service==='remote_access').health,'healthy');}
 const observationStore=new RemoteProbeObservationStore(f.db.pool),monitor=new MonitorWorker(f.db.pool,f.db.outbox),monitoringTargets=await new RemoteProbeStore(f.db.pool).targets();assert.equal(monitoringTargets.length,2);
 const probeAndRecord=async(options={})=>{await delay(2);const results=await Promise.all(monitoringTargets.map(target=>probeTarget(target,{ca:acme.certificateRoot,connect:fixtureConnect,...options})));for(const result of results)assert.equal(await observationStore.record(result),true);return results;};
 const resultFor=(values,venue)=>values.find(value=>value.installationId===venue.placement.installationId);
 const routeEvidence=values=>values.map(result=>({installationId:result.installationId,staffHostname:result.staffHostname,publicHostname:result.publicHostname,publicFingerprint:result.public.certificate.fingerprint256,staffFingerprint:result.staff.certificate.fingerprint256})).sort((a,b)=>a.installationId.localeCompare(b.installationId));
 const runMonitor=async(worker=monitor)=>{await f.db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');let count=0;while(await worker.runOnce()){if(++count>venues.length)throw Error('monitor processed too many venues');}return count;};
 const openIncidents=async()=>{const result=await f.db.pool.query("SELECT venue_id,kind FROM venue_incidents WHERE status='open' ORDER BY venue_id,kind");return result.rows;};
 const accountContext=await f.browser.newContext({locale:'en',viewport:{width:1280,height:900},colorScheme:'light'}),accountLogin=await accountContext.request.post(f.origin+'/api/account/login',{headers:{origin:f.origin},data:{email,password}});assert.equal(accountLogin.status(),200,await accountLogin.text());
 const csrf=(await accountContext.cookies()).find(cookie=>cookie.name.endsWith('cloud_csrf'))?.value;assert.ok(csrf);
 const preference=await accountContext.request.post(f.origin+'/api/account/alerts',{headers:{origin:f.origin,'x-csrf-token':csrf},data:{enabled:'on',locale:'en'}});assert.equal(preference.status(),200,await preference.text());
 const overview=async()=>{const response=await accountContext.request.get(f.origin+'/api/account/installations');assert.equal(response.status(),200,await response.text());return (await response.json()).installations;};
 const mailCount=async(subject)=>{const response=await fetch(process.env.MAILPIT_TEST_URL+'/api/v1/messages?limit=200');assert.equal(response.status,200);const list=await response.json();assert.equal(Number(list.total),list.messages.length,'Mailpit receipt query did not include the complete mailbox');return list.messages.filter(message=>message.Subject===subject&&message.To.some(recipient=>recipient.Address===email)).length;};
 const openingSubject='Waitron Cloud: a venue needs attention',recoverySubject='Waitron Cloud: venue check recovered',phases=[],phase=async(name,started)=>{const incidents=await openIncidents();phases.push({name,elapsedMs:Date.now()-started,openIncidents:incidents.length});return incidents;};let duplicateMail=0,deduplicationChecks=0;
 let started=Date.now(),results=await probeAndRecord();assert(results.every(result=>result.public.status==='healthy'&&result.staff.status==='healthy'));assert.equal(await monitor.schedule(),2);assert.equal(await runMonitor(),2);
 let incidents=await phase('baseline',started);assert.equal(incidents.some(row=>row.kind.includes('route_failed')||row.kind.includes('probe_stale')),false);const baselineCertificateIncidents=incidents.filter(row=>row.kind.endsWith('_certificate_expiring')).length;await f.drainMail();const baselineOpenings=await mailCount(openingSubject),baselineRecoveries=await mailCount(recoverySubject);

 started=Date.now();docker('rm','-f',venues[0].peer);owned.delete(venues[0].peer);results=await probeAndRecord();const venueAFailure=resultFor(results,venues[0]),venueBHealthy=resultFor(results,venues[1]);assert.equal(venueAFailure.public.status,'failed');assert.equal(venueAFailure.staff.status,'failed');assert.equal(venueBHealthy.public.status,'healthy');assert.equal(venueBHealthy.staff.status,'healthy');await runMonitor();
 incidents=await phase('route_outage',started);const venueARoutes=incidents.filter(row=>row.venue_id===venues[0].placement.venueId&&row.kind.endsWith('_route_failed')),venueBRoutes=incidents.filter(row=>row.venue_id===venues[1].placement.venueId&&row.kind.endsWith('_route_failed')),routeFailureLimitedToVenueA=venueARoutes.length===2&&venueBRoutes.length===0;assert.deepEqual(venueARoutes.map(row=>row.kind).sort(),['public_route_failed','staff_route_failed']);assert.equal(routeFailureLimitedToVenueA,true);
 let accountInstallations=await overview(),venueAView=accountInstallations.find(item=>item.installationId===venues[0].placement.installationId),venueBView=accountInstallations.find(item=>item.installationId===venues[1].placement.installationId);assert.ok(venueAView);assert.ok(venueBView);assert.equal(venueAView.monitoring.remoteChecks.public.status,'failed');assert.equal(venueAView.monitoring.remoteChecks.staff.status,'failed');assert.equal(venueBView.monitoring.remoteChecks.public.status,'healthy');assert.equal(venueBView.monitoring.remoteChecks.staff.status,'healthy');
 const portalPage=await accountContext.newPage();await portalPage.goto(f.origin+'/account');await portalPage.getByText('The public website failed its latest external check. Check the gateway and the venue internet connection.',{exact:true}).waitFor();
 await f.drainMail();const routeOpenings=await mailCount(openingSubject);assert.equal(routeOpenings-baselineOpenings,2);await runMonitor();await f.drainMail();const repeatedRouteOpenings=await mailCount(openingSubject);duplicateMail+=repeatedRouteOpenings-routeOpenings;deduplicationChecks++;assert.equal(duplicateMail,0);

 started=Date.now();startPeer(venues[0],0);await waitFor(async()=>{try{return (await remote(venues[0].placement.staffHostname)).status===200;}catch{return false;}});results=await probeAndRecord();assert(results.every(result=>result.public.status==='healthy'&&result.staff.status==='healthy'));await runMonitor();incidents=await phase('route_recovery',started);assert.equal(incidents.some(row=>row.kind.endsWith('_route_failed')),false);await f.drainMail();const routeRecoveries=await mailCount(recoverySubject);assert.equal(routeRecoveries-baselineRecoveries,2);await portalPage.reload();await portalPage.getByText('The public website failed its latest external check. Check the gateway and the venue internet connection.',{exact:true}).waitFor({state:'detached'});

 started=Date.now();await f.db.pool.query("UPDATE remote_probe_observations SET checked_at=clock_timestamp()-interval '301 seconds'");await runMonitor();incidents=await phase('stale_worker',started);assert.equal(incidents.filter(row=>row.kind.endsWith('_probe_stale')).length,4);assert.equal(incidents.some(row=>row.kind.endsWith('_route_failed')),false);await f.drainMail();results=await probeAndRecord();await runMonitor();incidents=await openIncidents();assert.equal(incidents.filter(row=>row.kind.endsWith('_probe_stale')).length,0);assert.equal(incidents.some(row=>row.kind.endsWith('_route_failed')),false);await f.drainMail();

 started=Date.now();const invalidTarget=monitoringTargets.find(target=>target.installationId===venues[1].placement.installationId);assert.ok(invalidTarget);const invalidTrust=await probeTarget(invalidTarget,{ca:venues[0].certificate,connect:fixtureConnect});assert.equal(invalidTrust.public.status,'failed');assert.equal(invalidTrust.staff.status,'failed');assert.equal(invalidTrust.public.failure,'tls');assert.equal(invalidTrust.staff.failure,'tls');assert.doesNotMatch(JSON.stringify(invalidTrust),/127\.0\.0\.1|ECONN|self.signed/i);await phase('invalid_trust',started);

 const beforeGatewayEvidence=routeEvidence(results);started=Date.now();docker('rm','-f',name+'-gateway');owned.delete(name+'-gateway');results=await probeAndRecord();assert(results.every(result=>result.public.status==='failed'&&result.staff.status==='failed'));await runMonitor();incidents=await phase('gateway_outage',started);assert.equal(incidents.filter(row=>row.kind.endsWith('_route_failed')).length,4);await f.drainMail();
 const replacedAt=Date.now();startGateway();try{await waitFor(async()=>{for(const venue of venues)if((await remote(venue.placement.staffHostname)).status!==200)return false;return true;},180000);}catch(error){const status=await readFile(join(state,'status.json'),'utf8').catch(readError=>String(readError)),wireguard=docker('exec',name+'-gateway','wg','show'),peers=venues.map((venue,index)=>`peer-${index} public=${venue.key.publicKey}\n${docker('exec',venue.peer,'wg','show')}`).join('\n');throw new Error(`replacement gateway unavailable; status=${status}; wireguard=${wireguard}; peers=${peers}`,{cause:error});}const replacementMs=Date.now()-replacedAt;results=await probeAndRecord();assert(results.every(result=>result.public.status==='healthy'&&result.staff.status==='healthy'));assert.deepEqual(routeEvidence(results),beforeGatewayEvidence);await runMonitor();incidents=await phase('gateway_recovery',replacedAt);assert.equal(incidents.some(row=>row.kind.endsWith('_route_failed')),false);await f.drainMail();checks.push('monitor detects and recovers one-route and whole-gateway failures while preserving other-venue isolation, stable certificates and fresh control contact');

 started=Date.now();const furthestExpiry=Math.max(...results.flatMap(result=>[result.public,result.staff]).filter(service=>service.status==='healthy').map(service=>new Date(service.certificate.notAfter).getTime())),warningDays=Math.ceil((furthestExpiry-Date.now())/86400000)+1;assert.ok(warningDays>=1&&warningDays<=3650);const warningMonitor=new MonitorWorker(f.db.pool,f.db.outbox,{certificateWarningDays:warningDays});await runMonitor(warningMonitor);incidents=await phase('certificate_warning',started);const warningIncidents=incidents.filter(row=>row.kind.endsWith('_certificate_expiring')).length;assert.equal(warningIncidents,4);assert.ok(warningIncidents>baselineCertificateIncidents);await f.drainMail();
 const contacts=await f.db.pool.query("SELECT id,last_contact_at>clock_timestamp()-interval '15 minutes' AS fresh FROM installations WHERE id=ANY($1::uuid[]) ORDER BY id",[venues.map(venue=>venue.placement.installationId)]),controlContactStayedFresh=contacts.rows.every(row=>row.fresh);assert.equal(controlContactStayedFresh,true);
 const monitoring={version:1,phases,isolation:{routeFailureLimitedToVenueA,controlContactStayedFresh},mail:{openings:await mailCount(openingSubject),recoveries:await mailCount(recoverySubject),deduplicationChecks,duplicates:duplicateMail}};

 const moving=venues[0],unchanged=venues[1],staffBefore=(await remote(moving.placement.staffHostname)).certificate,publicBefore=(await remote(moving.placement.publicHostname)).certificate;
 const initialSource=await placementStore.manifest(cellId);await publish(initialSource);
 await publishTarget(await placementStore.manifest(targetCellId));startTargetGateway();await waitFor(async()=>JSON.parse(await readFile(join(targetState,'status.json'),'utf8')).ready);
 const expectedRevision=Number((await f.db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[moving.placement.installationId])).rows[0].configuration_revision);
 const failedOperation=randomUUID(),failedStage=JSON.parse(await operator('move-stage',{operationId:failedOperation,installationId:moving.placement.installationId,targetCellId,targetPeerPublicKey:moving.key.publicKey,expectedRevision}));assert.equal(failedStage.state,'staged');
 const failedTarget=await placementStore.manifest(targetCellId);await publishTarget(failedTarget);await waitFor(async()=>JSON.parse(await readFile(join(targetState,'status.json'),'utf8')).routes===1);
 await assert.rejects(remoteTarget(moving.placement.staffHostname));const sourceStayedHealthy=(await remote(moving.placement.staffHostname)).status===200;assert.equal(sourceStayedHealthy,true);
 const failedCancelled=JSON.parse(await operator('move-cancel',{operationId:failedOperation,expectedRevision}));assert.equal(failedCancelled.state,'cancelled');
 const cancelledTarget=await placementStore.manifest(targetCellId);await publishTarget(cancelledTarget);await waitFor(async()=>JSON.parse(await readFile(join(targetState,'status.json'),'utf8')).routes===0);
 const destinationRemoved=await remoteTarget(moving.placement.staffHostname).then(()=>false,()=>true);assert.equal(destinationRemoved,true);

 const operationId=randomUUID(),staged=JSON.parse(await operator('move-stage',{operationId,installationId:moving.placement.installationId,targetCellId,targetPeerPublicKey:moving.key.publicKey,expectedRevision}));
 const stagedTarget=await placementStore.manifest(targetCellId);await publishTarget(stagedTarget);await waitFor(async()=>JSON.parse(await readFile(join(targetState,'status.json'),'utf8')).routes===1);
 docker('rm','-f',moving.peer);owned.delete(moving.peer);
 const targetPeerInput=join(root,'peer-target-0');await mkdir(targetPeerInput);await secret(join(targetPeerInput,'peer.json'),JSON.stringify({address:staged.target.address,privateKey:moving.key.privateKey,gatewayPublicKey:targetGatewayKey.publicKey,gatewayEndpoint:targetGatewayIp+':51820',upstreamHost:'host.docker.internal',upstreamPort:moving.server.port}));await secret(join(targetPeerInput,'ca.pem'),acme.certificateRoot);moving.peerInput=targetPeerInput;
 const movingAt=Date.now();startPeer(moving,0);await waitFor(async()=>{try{return (await remoteTarget(moving.placement.staffHostname)).status===200;}catch{return false;}},180000);
 const targetCookie=await solve(moving.placement.publicHostname,remoteTarget);assert.equal((await remoteTarget(moving.placement.publicHostname,'/public/availability',{headers:{cookie:targetCookie}})).status,200);const reconnectionMs=Date.now()-movingAt;
 assert.equal(JSON.parse(await operator('move-ready',{operationId,expectedRevision,sequence:stagedTarget.sequence})).state,'ready');
 const completed=JSON.parse(await operator('move-commit',{operationId,expectedRevision})),completedReplay=JSON.parse(await operator('move-commit',{operationId,expectedRevision}));assert.deepEqual(completedReplay,completed);
 const committedTarget=await placementStore.manifest(targetCellId),committedSource=await placementStore.manifest(cellId);await publishTarget(committedTarget);await publish(committedSource);
 await waitFor(async()=>{try{await remote(moving.placement.staffHostname);return false;}catch{return (await remote(unchanged.placement.staffHostname)).status===200&&(await remoteTarget(moving.placement.staffHostname)).status===200;}},15000);
 const targetRejectsOther=await remoteTarget(unchanged.placement.staffHostname).then(()=>false,()=>true);assert.equal(targetRejectsOther,true);
 const hostnamesPreserved=completed.target.staffHostname===moving.placement.staffHostname&&completed.target.publicHostname===moving.placement.publicHostname;assert.equal(hostnamesPreserved,true);
 const certificatesPreserved=(await remoteTarget(moving.placement.staffHostname)).certificate===staffBefore&&(await remoteTarget(moving.placement.publicHostname)).certificate===publicBefore;assert.equal(certificatesPreserved,true);
 const otherVenueIsolated=(await remote(unchanged.placement.staffHostname)).status===200&&targetRejectsOther;assert.equal(otherVenueIsolated,true);
 const oldRouteRevoked=await remote(moving.placement.staffHostname).then(()=>false,()=>true);assert.equal(oldRouteRevoked,true);
 const movement={version:1,failedApply:{cancelled:failedCancelled.state==='cancelled',sourceStayedHealthy,destinationRemoved},hostnamesPreserved,certificatesPreserved,otherVenueIsolated,oldRouteRevoked,completedReplayMatched:JSON.stringify(completedReplay)===JSON.stringify(completed),reconnectionMs,sequences:{initialSource:initialSource.sequence,failedTarget:failedTarget.sequence,cancelledTarget:cancelledTarget.sequence,stagedTarget:stagedTarget.sequence,committedSource:committedSource.sequence,committedTarget:committedTarget.sequence}};
 checks.push('one venue moves through a tested staged route while the other venue remains isolated; failed apply cancels without replacing the source');

 const held=tlsConnect({host:'127.0.0.1',port:targetGatewayPort,servername:moving.placement.staffHostname,ca:acme.certificateRoot});held.on('error',()=>{});await new Promise((resolve,reject)=>{held.once('secureConnect',resolve);held.once('error',reject);});held.write('GET /public/availability HTTP/1.1\r\nHost: '+moving.placement.staffHostname+'\r\n');
 await installations.revokeWithSession(session.token,session.csrfToken,moving.placement.installationId);const revokedAt=Date.now();await publishTarget(await placementStore.manifest(targetCellId));
 await waitFor(async()=>{try{await remoteTarget(moving.placement.staffHostname);return false;}catch{return (await remote(unchanged.placement.staffHostname)).status===200;}},15000);await waitFor(()=>held.destroyed,10000);const revocationMs=Date.now()-revokedAt;
 checks.push('Cloud revocation closes the selected venue and established connection while the other venue works');
 // A short signed lease exercises the same expiry path as the normal ten-minute window.
 const expiring=await placementStore.manifest(cellId);expiring.expiresAt=Date.now()+3000;await publish(expiring);await delay(4500);await assert.rejects(remote(venues[1].placement.staffHostname));
 docker('rm','-f',name+'-gateway');owned.delete(name+'-gateway');startGateway();await delay(1500);await assert.rejects(remote(venues[1].placement.staffHostname));checks.push('expired signed cache closes routing and stays expired after restart');
 const dnsName=name+'-lan-dns';docker('run','-d','--name',dnsName,'--network',name,'--cap-add','NET_ADMIN','waitron-cloud-local-remote:dev','dnsmasq','--no-daemon','--no-resolv','--address=/'+venues[1].placement.staffHostname+'/'+venues[1].placement.address);owned.add(dnsName);
 const dnsIp=docker('inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',dnsName);
 await delay(500);
 const lan=docker('exec',venues[1].peer,'node','-e',`const r=new(require('dns').Resolver);r.setServers(['${dnsIp}']);const req=require('https').get({hostname:'${venues[1].placement.staffHostname}',port:443,path:'/public/availability',ca:require('fs').readFileSync('/input/ca.pem'),lookup:(name,options,done)=>r.resolve4(name,(error,ips)=>done(error,options.all?ips?.map(address=>({address,family:4})):ips?.[0],4))},res=>{if(res.statusCode!==200)process.exit(1);res.resume();res.on('end',()=>console.log('LAN HTTPS trusted'));});req.on('error',error=>{console.error(error.message);process.exit(1)});req.setTimeout(3000,()=>req.destroy(Error('timeout')));`);
 assert.equal(lan,'LAN HTTPS trusted');checks.push('fresh DNS client uses venue LAN override with gateway authority expired');

 docker('rm','-f',name+'-gateway');owned.delete(name+'-gateway');await secret(join(state,'accepted.json'),'{broken');startGateway();await waitFor(()=>docker('inspect','--format','{{.State.Running}}',name+'-gateway')==='false');assert.notEqual(docker('inspect','--format','{{.State.ExitCode}}',name+'-gateway'),'0');checks.push('corrupt gateway cache refuses startup');
 const receipt={cloudHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cloudDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',waitronDirty:execFileSync('git',['-C',waitron,'status','--porcelain'],{encoding:'utf8'}).trim()!=='',waitronHead:execFileSync('git',['-C',waitron,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks,replacementMs,revocationMs,functionalProbes,monitoring,movement};
 if(process.env.REMOTE_RECEIPT)await secret(process.env.REMOTE_RECEIPT,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}catch(error){for(const container of owned){try{console.error(container,docker('logs','--tail','30',container));}catch{}}throw error;}
finally{for(const container of [...owned].reverse())docker('rm','-f',container);if(network)docker('network','rm',name);for(const child of children)await stop(child);await acme?.close();await f?.close();for(const venueRoot of roots)await rm(venueRoot,{recursive:true,force:true});await rm(root,{recursive:true,force:true});}
