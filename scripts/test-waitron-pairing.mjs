import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createPrivateKey,sign} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startPortalFixture} from '../apps/portal/test/fixtures.ts';
import {SignupStore} from '../packages/registration/src/index.ts';

const checkout=process.env.WAITRON_CHECKOUT;
assert.ok(checkout,'Set WAITRON_CHECKOUT to the Waitron checkout containing the Cloud adapter');
const waitron=resolve(checkout),require=createRequire(join(waitron,'apps/server/package.json'));
const f=await startPortalFixture();const children=[];const roots=[];
const password='Cloud integration owner password',email=`integration-${randomUUID()}@example.test`;
async function launch(root){
  await rm(join(root,'ready.json'),{force:true});
  const child=spawn(process.execPath,['--import',require.resolve('tsx'),join(waitron,'apps/server/scripts/cloud-integration-fixture.ts')],{
    cwd:join(waitron,'apps/server'),env:{...process.env,CLOUD_TEST_ROOT:root,CLOUD_TEST_ORIGIN:f.origin},stdio:['ignore','pipe','pipe'],
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
    let completions=0;
    if(index===1)await page.route('**/management-api/cloud/complete',async route=>{completions++;const result=await route.fetch();assert.equal(result.status(),200);await route.abort('failed');});
    await page.getByRole('button',{name:'Connect this venue',exact:true}).click();
    if(index===1){await page.getByText('This browser could not connect to Waitron.',{exact:false}).waitFor();assert.equal(completions,1);await page.getByRole('button',{name:'Check connection',exact:true}).click();}
    await page.getByText('Connected',{exact:true}).waitFor();const result=await (await context.request.get(`${server.origin}/management-api/cloud/status`)).json();
    registrations.push(result.registration);assert.equal(result.code,'');await cloud.close();
  }
  assert.notEqual(registrations[0].installationId,registrations[1].installationId);assert.notEqual(registrations[0].venueId,registrations[1].venueId);
  const first=JSON.parse(await readFile(join(locals[0].root,'cloud-connection.json'),'utf8'));
  const second=JSON.parse(await readFile(join(locals[1].root,'cloud-connection.json'),'utf8'));
  const bytes=Buffer.from(JSON.stringify(['waitron-cloud-pair-v1',f.origin,'status',second.requestId,first.publicKey,first.localVenueId,first.environment,'','','',Date.now()]));
  const signature=sign(null,bytes,createPrivateKey({key:Buffer.from(first.privateKey,'base64url'),format:'der',type:'pkcs8'})).toString('base64url');
  const swapped=await locals[0].context.request.post(`${f.origin}/api/pairing/status`,{data:{payload:bytes.toString('base64url'),signature}});assert.equal(swapped.status(),400);
  assert.equal((await swapped.json()).error,'binding_conflict');
  const cloudHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();const waitronHead=execFileSync('git',['-C',waitron,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const receipt={cloudHead,waitronHead,waitronDirty:execFileSync('git',['-C',waitron,'status','--porcelain'],{encoding:'utf8'}).trim()!=='' ,venues:2,checks:['real boot and SQLite manager login','both browser confirmation screens','restart before completion','committed completion with lost reply','cross-installation proof rejected'],registrations};
  if(process.env.PAIRING_RECEIPT)await writeFile(process.env.PAIRING_RECEIPT,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt,null,2));
}finally{
  for(const child of children)await stop(child);
  await f.close();for(const root of roots)await rm(root,{recursive:true,force:true});
}
