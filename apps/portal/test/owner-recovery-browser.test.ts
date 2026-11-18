import {actionTestTotp} from '../../../packages/registration/test/fixtures/action-proof.ts';
import {emailLoginPolicy} from '../../../packages/account-http/test/fixtures.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadavg} from 'node:os';
import {test} from 'node:test';
import {PasswordRecoveryStore} from '@waitron-cloud/registration';
import {connectedVenue} from '../../../packages/translation/test/fixtures.ts';
import {setRecoveryScope} from '../../../packages/registration/test/fixtures/recovery-scope.ts';
import {startPortalFixture,addVirtualAuthenticator} from './fixtures.ts';
import {translations} from '../src/locale.ts';
import {failPortalWait,portalTrace} from './portal-trace.ts';
async function resetLink(f:Awaited<ReturnType<typeof startPortalFixture>>,accountId:string){
 const email=(await f.db.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[accountId])).rows[0].email;
 await new PasswordRecoveryStore(f.db.pool,f.db.outbox).request(email);
 const mail=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='password_reset' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);return mail.token;
}
function hold(){
 let release!:()=>void;
 const until=new Promise<void>(resolve=>{release=resolve;});
 return {until,release};
}
test('reset link recovers through the real Cloud box decision, then enrolls a new passkey',async t=>{
 const f=await startPortalFixture(undefined,undefined,{keys:{activeKeyId:'test',keys:{test:'07'.repeat(32)}},policy:emailLoginPolicy},undefined,false,undefined,undefined,undefined,'ES');
 const context=await f.browser.newContext();let virtual:Awaited<ReturnType<typeof addVirtualAuthenticator>>|undefined;
 try{
  const box=await connectedVenue(f.db,f.issuer,f.origin),other=await connectedVenue(f.db,f.issuer,f.origin);
  await f.db.pool.query('DELETE FROM organisation_memberships WHERE organisation_id=$1',[other.organisationId]);await f.db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,true)',[box.accountId,other.organisationId]);
  const token=await resetLink(f,box.accountId),page=await context.newPage();page.setDefaultTimeout(6000);virtual=await addVirtualAuthenticator(context,page);
  await page.goto(f.origin+'/reset-password#token='+token);assert.equal(new URL(page.url()).hash,'');
  await page.getByRole('button',{name:'Lost your sign-in method?',exact:true}).click();await page.locator('#owner-recovery-venue').waitFor();assert.equal(await page.getByRole('heading',{level:1}).textContent(),'Recover your account');
  async function look(stage:string){for(const lang of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280]){
   await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});await page.locator('header select').selectOption(lang);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/owner-recovery-${stage}-${lang}-${theme}-${width}.png`,import.meta.url).pathname,fullPage:true});
  }await page.locator('header select').selectOption('en');}
  await look('choose');await page.locator('#owner-recovery-venue').selectOption(box.installationId);
  await page.getByRole('button',{name:'Request box approval',exact:true}).click();await page.getByRole('button',{name:'Check approval',exact:true}).waitFor();await look('pending');
  const read=await context.request.post(f.origin+'/api/installations/owner-recovery-read',{data:box.proof('owner-recovery-read',{},randomUUID(),box.lease)});assert.equal(read.status(),200);
  const request=(await read.json()).requests[0];assert.equal(request.accountId,box.accountId);
  const approved=await context.request.post(f.origin+'/api/installations/owner-recovery-approve',{data:box.proof('owner-recovery-approve',{request,approvedBy:randomUUID()},request.requestId,box.lease)});assert.equal(approved.status(),200);
  await page.getByRole('button',{name:'Check approval',exact:true}).click();await page.locator('input[name=ownerRecoveryPassword]').waitFor();await look('approved');
  const trace=portalTrace(page),proof=hold(),session=hold(),list=hold();
  let sessionReads=0,clicked=false,stage='initial proof read';
  const step=(name:string)=>{stage=name;trace.stage(name);};
  await page.route('**/api/account/action-proof',async route=>{await proof.until;await route.continue();});
  await page.route('**/api/account/session',async route=>{if(++sessionReads===2)await session.until;await route.continue();});
  await page.route('**/api/account/session/activity',async route=>{await session.until;await route.continue();});
  await page.route('**/api/account/passkeys',async route=>{if(clicked)await list.until;await route.continue();});
  try{
   const password=page.locator('input[name=ownerRecoveryPassword]');
   await password.fill('A fresh box recovered password');
   await Promise.all([page.waitForRequest('**/api/account/action-proof'),password.press('Enter')]);
   await page.getByText(translations.en.enrollmentRequiredHelp,{exact:true}).waitFor();assert.equal(await page.locator('#installations-section').count(),0);
   step('Add a passkey click after Account navigation');
   await Promise.all([page.waitForRequest('**/api/account/action-proof'),page.getByRole('button',{name:translations.en.passkeyAdd,exact:true}).click()]);
   clicked=true;
   step('passkey list after click');
   const started=page.waitForRequest('**/api/account/passkeys');
   session.release();await started;
   step('waiting for proof while passkey list is held');
   proof.release();await page.getByText(translations.en.actionProofReady,{exact:true}).waitFor();
   step('proof ready, waiting for Account');
   list.release();await page.getByText(translations.en.accountIntro,{exact:true}).waitFor();
   await page.unrouteAll({behavior:'wait'});
  }catch(error){
   t.diagnostic(JSON.stringify({loadAverage:loadavg()}));
   await failPortalWait(page,trace,stage,error,details=>t.diagnostic(details));
  }finally{proof.release();session.release();list.release();}
  assert.equal((await f.db.pool.query('SELECT recovery_organisation_id FROM cloud_accounts WHERE id=$1',[box.accountId])).rows[0].recovery_organisation_id,box.organisationId);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_passkeys WHERE account_id=$1',[box.accountId])).rows[0].count,'1');

  const c=translations.en,email=(await f.db.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[box.accountId])).rows[0].email;
  const confined=async()=>{const response=await context.request.get(f.origin+'/api/account/installations');assert.equal(response.status(),200);assert.deepEqual((await response.json()).installations.map((i:{installationId:string})=>i.installationId),[box.installationId]);};
  const signout=async()=>{await page.getByRole('button',{name:c.signout,exact:true}).click();await page.getByRole('heading',{name:c.login,exact:true}).waitFor();};
  const passwordLogin=async()=>{await page.locator('input[name=email]').fill(email);await page.locator('input[name=password]').fill('A fresh box recovered password');await page.getByRole('button',{name:c.login,exact:true}).click();await page.locator('input[name=factorProof]').waitFor();};
  await confined();await signout();await page.getByRole('button',{name:c.passkeySignIn,exact:true}).click();await page.getByText(c.accountIntro,{exact:true}).waitFor();await confined();
  await page.getByRole('button',{name:c.actionProofPasskey,exact:true}).click();await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  await page.getByRole('button',{name:c.factorEnable,exact:true}).click();await page.locator('.factor-secret').waitFor();const secret=(await page.locator('.factor-secret').textContent())!;
  await page.locator('input[name=factorConfirmation]').fill(actionTestTotp(secret));await page.getByRole('button',{name:c.factorActivate,exact:true}).click();await page.locator('.factor-codes').waitFor();const codes=await page.locator('.factor-codes code').allTextContents();await page.getByRole('button',{name:c.factorCodesSaved,exact:true}).click();
  await passwordLogin();await page.locator('input[name=factorProof]').fill(actionTestTotp(secret,1));await page.getByRole('button',{name:c.factorVerify,exact:true}).click();await page.getByText(c.accountIntro,{exact:true}).waitFor();await confined();
  await signout();await passwordLogin();await page.getByLabel(c.factorProofType,{exact:true}).selectOption('recovery');await page.locator('input[name=factorProof]').fill(codes[0]!);await page.getByRole('button',{name:c.factorVerify,exact:true}).click();await page.getByText(c.accountIntro,{exact:true}).waitFor();await confined();
  await f.db.pool.query("UPDATE password_reset_requests SET created_at=clock_timestamp()-interval '61 seconds' WHERE account_id=$1",[box.accountId]);
  const ordinary=await resetLink(f,box.accountId);await page.goto(f.origin+'/reset-password#token='+ordinary);await page.locator('input[name=password]').fill('Another long recovered account password');await page.locator('input[name=password]').press('Enter');await page.getByText(c.resetReady,{exact:true}).waitFor();
  await page.getByRole('link',{name:c.login,exact:true}).click();await page.getByRole('button',{name:c.passkeySignIn,exact:true}).click();await page.getByText(c.accountIntro,{exact:true}).waitFor();await confined();

 }finally{await virtual?.close();await context.close();await f.close();}
});
test('the verified recovery chooser explains the existing A restriction in English and Spanish',async()=>{
 const f=await startPortalFixture(undefined,undefined,undefined,undefined,false,undefined,undefined,undefined,'ES');
 try{for(const locale of ['en','es'] as const){
  const box=await connectedVenue(f.db,f.issuer,f.origin),token=await resetLink(f,box.accountId),context=await f.browser.newContext();
  try{
   const page=await context.newPage();page.setDefaultTimeout(6000);await page.goto(f.origin+'/reset-password#token='+token+'&lang='+locale);
   await page.getByRole('button',{name:locale==='en'?'Lost your sign-in method?':'¿Has perdido tu método de acceso?',exact:true}).click();await page.locator('#owner-recovery-venue').selectOption(box.installationId);
   await setRecoveryScope(f.db.pool,box.accountId);
   await page.getByRole('button',{name:locale==='en'?'Request box approval':'Solicitar aprobación del equipo',exact:true}).click();
   await page.getByText(locale==='en'?'This account is limited to another business. Use a paired box from that business to recover access.':'Esta cuenta está limitada a otro negocio. Usa un equipo vinculado de ese negocio para recuperar el acceso.',{exact:true}).waitFor();
  }finally{await context.close();}
 }}finally{await f.close();}
});

test('an unavailable reset link explains how to restart box recovery',async()=>{
 const f=await startPortalFixture(undefined,undefined,undefined,undefined,false,undefined,undefined,undefined,'ES'),context=await f.browser.newContext();
 try{const page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(f.origin+'/reset-password#token='+'a'.repeat(43));
  await page.getByRole('button',{name:translations.en.ownerRecoveryLost,exact:true}).click();await page.getByText(translations.en.ownerRecoveryUnavailable,{exact:true}).waitFor();
 }finally{await context.close();await f.close();}
});
