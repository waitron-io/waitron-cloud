import {actionTestTotp} from '../../../packages/registration/test/fixtures/action-proof.ts';
import {emailLoginPolicy} from '../../../packages/account-http/test/fixtures.ts';
import {OwnerTransferStore} from '@waitron-cloud/registration';
import {translations} from '../src/locale.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {SignupStore} from '@waitron-cloud/registration';
import {addVirtualAuthenticator,contextSignIn,prepareBrowserActionWindow,startPortalFixture} from './fixtures.ts';
const password='A real ownership handover password';
test('existing-account handover completes in both languages, themes and widths',async t=>{
 const f=await startPortalFixture();
 try{for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280]){
  await f.db.pool.query('DELETE FROM account_rate_limits');
  const actors=[];for(const role of ['sender','recipient']){
   const email=`${role}-${randomUUID()}@example.test`,signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);
   const mail=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
   actors.push({...await signup.complete(mail.token,{password,organisationName:role==='sender'?'Café Sol':'Café Luna',legalBusinessName:'Sol SL',countryCode:'ES'}),email});
  }
  const [sender,recipient]=actors;assert.ok(sender&&recipient);
  const c=locale==='en'?{email:'Recipient email',send:'Send handover',accept:'Accept handover',pending:'Pending',accepted:'Accepted'}:{email:'Correo de quien recibe',send:'Enviar traspaso',accept:'Aceptar traspaso',pending:'Pendiente',accepted:'Aceptado'};
  const contexts=await Promise.all([f.browser.newContext({locale,colorScheme,viewport:{width,height:900}}),f.browser.newContext({locale,colorScheme,viewport:{width,height:900}})]);
  try{
   for(const [index,actor] of actors.entries()){assert.equal((await contextSignIn(f,contexts[index]!,actor.email,password)).status(),200);await prepareBrowserActionWindow(f,contexts[index]!,actor.accountId);}
   const page=await contexts[0]!.newPage();page.on('pageerror',error=>t.diagnostic(error.message));page.setDefaultTimeout(5000);await page.goto(`${f.origin}/account#lang=${locale}`);
   try{await page.getByLabel(c.email,{exact:true}).fill(recipient.email);}catch(error){t.diagnostic(await page.locator('body').innerText());throw error;}await page.getByRole('button',{name:c.send,exact:true}).click();
   const outgoing=page.locator('#owner-transfer-section');await outgoing.getByText(c.pending,{exact:true}).waitFor();await outgoing.getByText(recipient.email,{exact:true}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await outgoing.screenshot({path:new URL(`../dist/handover-sender-${locale}-${colorScheme}-${width}.png`,import.meta.url).pathname});
   const receiving=await contexts[1]!.newPage();receiving.setDefaultTimeout(5000);await receiving.goto(`${f.origin}/account#lang=${locale}`);
   const incoming=receiving.locator('#owner-transfer-section');await incoming.getByRole('button',{name:c.accept,exact:true}).waitFor();await incoming.getByText(sender.email,{exact:true}).waitFor();
   assert.ok(await receiving.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await incoming.screenshot({path:new URL(`../dist/handover-recipient-${locale}-${colorScheme}-${width}.png`,import.meta.url).pathname});
   await incoming.getByRole('button',{name:c.accept,exact:true}).click();await incoming.getByText(c.accepted,{exact:true}).waitFor();
   assert.deepEqual((await f.db.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner',[sender.organisationId])).rows,[{account_id:recipient.accountId}]);
   await page.reload();await outgoing.getByText(c.accepted,{exact:true}).waitFor();assert.equal(await outgoing.getByRole('button',{name:c.send,exact:true}).count(),0,'former owner has no business left to offer');
  }finally{await Promise.all(contexts.map(context=>context.close()));}
 }}finally{await f.close();}
});

test('recipient enrolls an app, signs in again and returns to the same pending handover',async()=>{
 const f=await startPortalFixture(undefined,undefined,{keys:{activeKeyId:'test',keys:{test:'07'.repeat(32)}},policy:emailLoginPolicy}),context=await f.browser.newContext();
 try{
  const actors=[];for(const role of ['sender','recipient']){
   const email=`${role}-${randomUUID()}@example.test`,signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);
   const mail=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
   actors.push({...await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),email});
  }
  const [sender,recipient]=actors;assert.ok(sender&&recipient);
  const session=await contextSignIn(f,context,sender.email,password);assert.equal(session.status(),200);await prepareBrowserActionWindow(f,context,sender.accountId);
  const senderCookies=await context.cookies(),store=new OwnerTransferStore(f.db.pool,f.db.outbox);
  const offer=await store.create(senderCookies.find(c=>c.name==='cloud_session')!.value,senderCookies.find(c=>c.name==='cloud_csrf')!.value,sender.organisationId,recipient.email);
  assert.equal((await contextSignIn(f,context,recipient.email,password)).status(),200);await prepareBrowserActionWindow(f,context);
  const page=await context.newPage();page.setDefaultTimeout(7000);const c=translations.en;await page.goto(f.origin+'/account');
  await page.locator('#owner-transfer-section').getByRole('button',{name:'Accept handover',exact:true}).waitFor();
  await page.locator('#factor-enable').click();await page.locator('.factor-secret').waitFor();const secret=(await page.locator('.factor-secret').textContent())!;
  await page.getByLabel(c.factorConfirmation,{exact:true}).fill(actionTestTotp(secret));await page.getByRole('button',{name:c.factorActivate,exact:true}).click();
  await page.locator('.factor-codes').waitFor();await page.getByRole('button',{name:c.factorCodesSaved,exact:true}).click();
  await page.locator('input[name=email]').fill(recipient.email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  await page.locator('input[name=factorProof]').fill(actionTestTotp(secret,1));await page.getByRole('button',{name:c.factorVerify,exact:true}).click();
  await page.locator('#owner-transfer-section').getByRole('button',{name:'Accept handover',exact:true}).waitFor();await prepareBrowserActionWindow(f,page);
  // Refresh proof status through the existing account read after this journey’s proof fixture.
  await page.reload();await page.locator('#owner-transfer-section').getByRole('button',{name:'Accept handover',exact:true}).click();await page.locator('#owner-transfer-section').getByText('Accepted',{exact:true}).waitFor();
  assert.equal((await f.db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'accepted');
 }finally{await context.close();await f.close();}
});

test('recipient’s first passkey preserves the offer but requires a new proof before acceptance',async()=>{
 const f=await startPortalFixture(),context=await f.browser.newContext();let virtual:Awaited<ReturnType<typeof addVirtualAuthenticator>>|undefined;
 try{
  const actors=[];for(const role of ['sender','recipient']){
   const email=`${role}-${randomUUID()}@example.test`,signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);
   const mail=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
   actors.push({...await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),email});
  }
  const [sender,recipient]=actors;assert.ok(sender&&recipient);
  assert.equal((await contextSignIn(f,context,sender.email,password)).status(),200);await prepareBrowserActionWindow(f,context,sender.accountId);
  const cookies=await context.cookies(),offer=await new OwnerTransferStore(f.db.pool,f.db.outbox).create(cookies.find(c=>c.name==='cloud_session')!.value,cookies.find(c=>c.name==='cloud_csrf')!.value,sender.organisationId,recipient.email);
  assert.equal((await contextSignIn(f,context,recipient.email,password)).status(),200);await prepareBrowserActionWindow(f,context);
  const page=await context.newPage();page.setDefaultTimeout(6000);virtual=await addVirtualAuthenticator(context,page);const c=translations.en;await page.goto(f.origin+'/account');
  await page.getByRole('button',{name:c.passkeyAdd,exact:true}).click();await page.getByText(c.passkeyAdded,{exact:true}).waitFor();
  await page.locator('#owner-transfer-section').getByRole('button',{name:'Accept handover',exact:true}).click();
  await page.getByRole('button',{name:c.actionProofPasskey,exact:true}).waitFor();
  assert.equal((await f.db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'pending');
  await page.getByRole('button',{name:c.actionProofPasskey,exact:true}).click();await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  await page.locator('#owner-transfer-section').getByRole('button',{name:'Accept handover',exact:true}).click();await page.locator('#owner-transfer-section').getByText('Accepted',{exact:true}).waitFor();
 }finally{await virtual?.close();await context.close();await f.close();}
});
