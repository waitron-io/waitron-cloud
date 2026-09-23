import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createPrivateKey,sign} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startPortalFixture} from '../apps/portal/test/fixtures.ts';
import {InstallationStore,SignupStore} from '../packages/registration/src/index.ts';

const checkout=process.env.WAITRON_CHECKOUT;
assert.ok(checkout,'Set WAITRON_CHECKOUT to the Waitron checkout containing the Cloud adapter');
const waitron=resolve(checkout),require=createRequire(join(waitron,'apps/server/package.json'));
const f=await startPortalFixture();const children=[];const roots=[];
const password='Cloud integration owner password',email=`integration-${randomUUID()}@example.test`;
async function launch(root){
  await rm(join(root,'ready.json'),{force:true});
  const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(waitron,'apps/server/scripts/cloud-integration-fixture.ts')],{
    cwd:join(waitron,'apps/server'),env:{...process.env,CLOUD_TEST_ROOT:root,CLOUD_TEST_ORIGIN:f.origin},stdio:['ignore','pipe','pipe','ipc'],
  });
  let output='';child.stdout.on('data',v=>{output=(output+v.toString()).slice(-32000);});child.stderr.on('data',v=>{output=(output+v.toString()).slice(-32000);});
  const done=new Promise(resolve=>child.once('exit',resolve));const running={child,done};children.push(running);
  for(let i=0;i<300;i++){
    if(child.exitCode!==null)throw new Error(`Waitron fixture exited: ${output}`);
    try{return {...running,...JSON.parse(await readFile(join(root,'ready.json'),'utf8'))};}catch(error){if(error.code!=='ENOENT')throw error;}
    await delay(100);
  }
  throw new Error(`Waitron fixture did not start: ${output}`);
}
async function stop(running){
  if(running.child.exitCode!==null)return;
  running.child.kill('SIGTERM');
  const timeout=setTimeout(()=>running.child.kill('SIGKILL'),5000);
  try{await running.done;}finally{clearTimeout(timeout);}
}
try{
  const signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);
  const row=(await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0];const payload=f.db.outbox.open(row);assert.ok('token' in payload);
  await signup.complete(payload.token,{password,organisationName:'Cloud Integration',legalBusinessName:'Two Cafés SL',countryCode:'ES'});
  const registrations=[];const locals=[];
  for(let index=0;index<2;index++){
    const root=await mkdtemp(join(tmpdir(),'cloud-integration-'));roots.push(root);let server=await launch(root);
    const context=await f.browser.newContext({locale:'en'});const page=await context.newPage();page.setDefaultTimeout(10000);
    const login=await context.request.post(`${server.origin}/management-api/session`,{headers:{origin:server.origin},data:{email:'owner@example.test',password:'Local integration password'}});
    assert.equal(login.status(),200,await login.text());
    await page.goto(`${server.origin}/manage/cloud`);await page.getByRole('button',{name:'Connect to Cloud',exact:true}).click();
    const localScreen=page.locator('dashboard-cloud-services-screen');await localScreen.locator('.code').waitFor();const code=(await localScreen.locator('.code').innerText()).trim();assert.match(code,/^\d{8}$/);
    const status=await (await context.request.get(`${server.origin}/management-api/cloud/status`)).json();assert.equal(status.localVenueId,server.localVenueId);assert.equal(status.environment,'test');
    locals.push({root,server,status,context});
    const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Open Cloud',exact:true}).click();const cloud=await popupPromise;cloud.setDefaultTimeout(10000);
    await cloud.getByLabel('Email').fill(email);await cloud.locator('input[name=password]').fill(password);await cloud.getByRole('button',{name:'Sign in',exact:true}).click();
    await cloud.getByRole('textbox',{name:'Code shown in Waitron',exact:true}).fill(code);await cloud.getByRole('button',{name:'Check code',exact:true}).click();
    await cloud.getByText(server.localVenueId,{exact:true}).waitFor();await cloud.getByRole('button',{name:'Approve this venue',exact:true}).click();await cloud.getByText('Approved in Cloud.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Check connection',exact:true}).click();await page.getByText('Two Cafés SL',{exact:true}).waitFor();
    if(index===0){await stop(server);server=await launch(root);await page.reload();await page.getByRole('button',{name:'Connect this venue',exact:true}).waitFor();}
    let completions=0,completionStatus;
    if(index===1)await page.route('**/management-api/cloud/complete',async route=>{completions++;const result=await route.fetch();completionStatus=result.status();await route.abort('failed');});
    await page.getByRole('button',{name:'Connect this venue',exact:true}).click();
    if(index===1){await page.getByText('This browser could not connect to Waitron.',{exact:false}).waitFor();assert.equal(completions,1);assert.equal(completionStatus,200);await page.getByRole('button',{name:'Check connection',exact:true}).click();}
    await page.getByText('Connected',{exact:true}).waitFor();const result=await (await context.request.get(`${server.origin}/management-api/cloud/status`)).json();
    registrations.push(result.registration);locals[index].server=server;assert.equal(result.code,'');await cloud.close();
  }
  assert.notEqual(registrations[0].installationId,registrations[1].installationId);assert.notEqual(registrations[0].venueId,registrations[1].venueId);
  const first=JSON.parse(await readFile(join(locals[0].root,'cloud-connection.json'),'utf8'));
  const second=JSON.parse(await readFile(join(locals[1].root,'cloud-connection.json'),'utf8'));
  const bytes=Buffer.from(JSON.stringify(['waitron-cloud-pair-v1',f.origin,'status',second.requestId,first.publicKey,first.localVenueId,first.environment,'','','',Date.now()]));
  const signature=sign(null,bytes,createPrivateKey({key:Buffer.from(first.privateKey,'base64url'),format:'der',type:'pkcs8'})).toString('base64url');
  const swapped=await locals[0].context.request.post(`${f.origin}/api/pairing/status`,{data:{payload:bytes.toString('base64url'),signature}});assert.equal(swapped.status(),400);
  assert.equal((await swapped.json()).error,'binding_conflict');
  const localPost=async(index,action)=>{
    const {server,context}=locals[index];return context.request.post(`${server.origin}/management-api/cloud/${action}`,{headers:{origin:server.origin},data:{}});
  };
  f.loseMachineReply('renew');assert.equal((await localPost(0,'refresh')).status(),503);
  const intent=JSON.parse(await readFile(join(locals[0].root,'cloud-connection.json'),'utf8')).lifecycle.pending;
  assert.equal(intent.action,'renew');
  await stop(locals[0].server);locals[0].server=await launch(locals[0].root);
  for(let attempt=0;attempt<100;attempt++){
    const status=await (await locals[0].context.request.get(`${locals[0].server.origin}/management-api/cloud/status`)).json();
    if(status.installation?.state==='active')break;
    if(attempt===99)throw new Error('Background renewal did not recover');await delay(50);
  }
  const recovered=JSON.parse(await readFile(join(locals[0].root,'cloud-connection.json'),'utf8'));
  const recorded=(await f.db.pool.query('SELECT result FROM installation_operations WHERE installation_id=$1 AND operation_id=$2',[registrations[0].installationId,intent.operationId])).rows[0];
  assert.deepEqual(recovered.lifecycle.lease,recorded.result.lease);
  assert.equal((await localPost(1,'refresh')).status(),200);
  const installations=new InstallationStore(f.db.pool,f.issuer,f.origin);
  await installations.configure(registrations[0].installationId,0,[{service:'remote_access',state:'provisioning',configuration:{hostname:'first.example.test'}}]);
  await installations.configure(registrations[1].installationId,0,[{service:'continuous_backup',state:'provisioning',configuration:{prefix:'second/'}}]);
  for(let index=0;index<2;index++)assert.equal((await localPost(index,'refresh')).status(),200);
  const report=(index,health)=>new Promise((resolve,reject)=>{
    const child=locals[index].server.child;const timeout=setTimeout(()=>{child.removeListener('message',reply);reject(new Error('Report timeout'));},10000);
    const reply=value=>{clearTimeout(timeout);if(value.error)reject(new Error(value.error));else resolve(value.status);};child.once('message',reply);
    child.send({report:[{service:'remote_access',health,failure:health==='failed'?'unavailable':null}]});
  });
  const healthy=await report(0,'healthy'),failed=await report(1,'failed');
  assert.equal(healthy.installation.services.find(s=>s.service==='remote_access').health,'healthy');
  assert.equal(failed.installation.services.find(s=>s.service==='remote_access').health,'failed');
  assert.equal(healthy.installation.services.find(s=>s.service==='continuous_backup').state,'unconfigured');
  assert.equal(failed.installation.services.find(s=>s.service==='continuous_backup').state,'provisioning');
  f.loseMachineReply('revoke');assert.equal((await localPost(0,'revoke')).status(),503);
  await stop(locals[0].server);locals[0].server=await launch(locals[0].root);
  for(let attempt=0;attempt<100;attempt++){
    const status=await (await locals[0].context.request.get(`${locals[0].server.origin}/management-api/cloud/status`)).json();
    if(status.installation?.state==='revoked')break;
    if(attempt===99)throw new Error('Background revocation did not recover');await delay(50);
  }
  const revokedProofBytes=Buffer.from(JSON.stringify(['waitron-cloud-machine-v1',f.origin,'renew',registrations[0].installationId,randomUUID(),Date.now(),'','{}']));
  const revokedProof={payload:revokedProofBytes.toString('base64url'),signature:sign(null,revokedProofBytes,createPrivateKey({key:Buffer.from(first.privateKey,'base64url'),format:'der',type:'pkcs8'})).toString('base64url')};
  const refused=await locals[0].context.request.post(`${f.origin}/api/installations/renew`,{data:revokedProof});assert.equal(refused.status(),403);assert.equal((await refused.json()).error,'revoked');
  assert.equal((await localPost(1,'refresh')).status(),200);
  const cloudHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();const waitronHead=execFileSync('git',['-C',waitron,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const receipt={cloudHead,waitronHead,waitronDirty:execFileSync('git',['-C',waitron,'status','--porcelain'],{encoding:'utf8'}).trim()!=='' ,venues:2,checks:['real boot and SQLite manager login','both browser confirmation screens','restart before completion','committed completion with lost reply','cross-installation proof rejected','renewal response lost after Cloud commit, recovered by real Waitron restart and worker','independent desired configuration and synthetic adapter observations','revocation response lost, recovered on restart','revoked renewal refused while second venue stays connected'],registrations};
  if(process.env.PAIRING_RECEIPT)await writeFile(process.env.PAIRING_RECEIPT,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt,null,2));
}finally{
  for(const child of children)await stop(child);
  await f.close();for(const root of roots)await rm(root,{recursive:true,force:true});
}
