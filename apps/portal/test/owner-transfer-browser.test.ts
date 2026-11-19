import {actionTestTotp} from '../../../packages/registration/test/fixtures/action-proof.ts';
import {emailLoginPolicy} from '../../../packages/account-http/test/fixtures.ts';
import {OwnerTransferStore} from '@waitron-cloud/registration';
import {translations} from '../src/locale.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {PoolClient,QueryResult} from 'pg';
import {SignupStore} from '@waitron-cloud/registration';
import {addVirtualAuthenticator,contextSignIn,completeBrowserEmail,mailFor,prepareBrowserActionWindow,startPortalFixture} from './fixtures.ts';
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

test('first-time recipients verify, sign up without a business, enroll and explicitly accept',async t=>{
 const f=await startPortalFixture(undefined,undefined,{keys:{activeKeyId:'test',keys:{test:'07'.repeat(32)}},policy:emailLoginPolicy});
 const pool=f.db.pool,queries=new Map<PoolClient,PoolClient['query']>();
 let factorClock:{accountId:string;now:Date;reads:number;sessionReads:number}|undefined;
 const acquire=(client:PoolClient)=>{
  const query=client.query;
  queries.set(client,query);
  let factorAccountId:string|undefined,sessionClockNext=false;
  client.query=((...args:unknown[])=>{
   const result=Reflect.apply(query,client,args);
   const [sql,values,callback]=args;
   if(typeof sql!=='string'||typeof values==='function'||typeof callback==='function')return result;
   const clock=factorClock;
   const readClock=clock&&factorAccountId===clock.accountId&&sql==='SELECT clock_timestamp() AS now';
   // Session expiry uses the database time read immediately after the session row lock.
   const readSessionTime=sessionClockNext;
   sessionClockNext=sql.startsWith('SELECT last_seen_at, absolute_expires_at, csrf_hash FROM cloud_sessions');
   if(sql==='SELECT * FROM cloud_authenticator_factors WHERE account_id=$1 FOR UPDATE'&&Array.isArray(values)){
    factorAccountId=values[0];
   }
   if(!readClock)return result;
   return result.then((actual:QueryResult)=>{
    if(readSessionTime){
     clock.sessionReads++;
     return actual;
    }
    clock.reads++;
    return {...actual,rows:[{...actual.rows[0],now:clock.now}]};
   });
  }) as PoolClient['query'];
 };
 const release=(_error:Error|undefined,client:PoolClient)=>{
  const query=queries.get(client);
  if(query)client.query=query;
  queries.delete(client);
 };
 pool.on('acquire',acquire);
 pool.on('release',release);
 try{for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280]){
  await f.db.pool.query('DELETE FROM account_rate_limits');
  const c=translations[locale],senderEmail=`sender-${randomUUID()}@example.test`,email=`first-${randomUUID()}@example.test`,signup=new SignupStore(f.db.pool,f.db.outbox);
  await signup.request(senderEmail);const verification=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in verification);
  const sender=await signup.complete(verification.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  const sending=await f.browser.newContext(),context=await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}});
  try{
   assert.equal((await contextSignIn(f,sending,senderEmail,password)).status(),200);await prepareBrowserActionWindow(f,sending,sender.accountId);
   const cookies=await sending.cookies(),offer=await new OwnerTransferStore(f.db.pool,f.db.outbox).create(cookies.find(c=>c.name==='cloud_session')!.value,cookies.find(c=>c.name==='cloud_csrf')!.value,sender.organisationId,email,locale);
   await f.drainMail();const invitation=await mailFor(email,locale==='en'?'Waitron Cloud ownership handover':'Traspaso de titularidad de Waitron Cloud',f.mailEvidence);
   const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>t.diagnostic(e.message));
   const link=invitation.match(/http:\/\/localhost:[^\s]+\/signup/)?.[0];assert.ok(link);await page.goto(link+`#lang=${locale}`);
   await page.locator('input[name=email]').fill(email);await page.locator('#submit').click();await page.getByText(c.emailSent,{exact:true}).waitFor();await f.drainMail();
   const mail=await mailFor(email,locale==='en'?'Verify your Waitron Cloud email':'Verifica tu correo de Waitron Cloud',f.mailEvidence),url=mail.match(/http:\/\/localhost:[^\s]+/)?.[0];assert.ok(url);await page.goto(url);
   await page.getByLabel(locale==='en'?"I'm receiving a business":'Estoy recibiendo un negocio',{exact:true}).check();
   assert.equal(await page.locator('input[name=legalBusinessName]').count(),0);await page.locator('input[name=password]').fill(password);
   async function look(stage:string){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/first-handover-${stage}-${locale}-${colorScheme}-${width}.png`,import.meta.url).pathname,fullPage:true});}
   await look('signup');await page.locator('#submit').click();await page.getByText(c.signupReady,{exact:true}).waitFor();
   const recipient=(await f.db.pool.query('SELECT account_id FROM cloud_credentials WHERE email=$1',[email])).rows[0].account_id;
   assert.equal((await f.db.pool.query('SELECT count(*) FROM organisation_memberships WHERE account_id=$1',[recipient])).rows[0].count,'0');
   await page.getByRole('link',{name:c.login,exact:true}).click();
   const login=async()=>{await page.locator('input[name=email]').fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();};
   await login();await completeBrowserEmail(f,page,email,locale);await page.getByText(c.accountIntro,{exact:true}).waitFor();
   await page.getByRole('button',{name:c.actionProofEmail,exact:true}).click();await page.locator('input[name=actionProofCode]').waitFor();await f.drainMail();
   const proofMail=await mailFor(email,locale==='en'?'Your Waitron Cloud verification code':'Tu código de verificación de Waitron Cloud',f.mailEvidence),code=proofMail.match(/^([0-9]{6})$/m)?.[1];assert.ok(code);
   await page.locator('input[name=actionProofCode]').fill(code);await page.locator('#action-proof-verify').click();await page.getByText(c.actionProofReady,{exact:true}).waitFor();
   await look('pending');
   // Keep the fixture outside the live code window so a missed clock substitution always fails.
   const {now}=(await pool.query<{now:Date}>("SELECT clock_timestamp() - interval '2 minutes' AS now")).rows[0]!;
   const clock=factorClock={accountId:recipient,now,reads:0,sessionReads:0};
   await page.locator('#factor-enable').click();await page.locator('.factor-secret').waitFor();const secret=(await page.locator('.factor-secret').textContent())!;
   let reads=clock.reads,sessionReads=clock.sessionReads;
   await page.getByLabel(c.factorConfirmation,{exact:true}).fill(actionTestTotp(secret,-1,now.getTime()));await page.getByRole('button',{name:c.factorActivate,exact:true}).click();await page.locator('.factor-codes').waitFor();
   assert.ok(clock.reads>reads,'activation reads the controlled factor clock');
   assert.ok(clock.sessionReads>sessionReads,'activation checks session expiry against live time');
   await page.getByRole('button',{name:c.factorCodesSaved,exact:true}).click();
   await login();await page.locator('input[name=factorProof]').fill(actionTestTotp(secret,0,now.getTime()));
   reads=clock.reads;
   await page.getByRole('button',{name:c.factorVerify,exact:true}).click();
   const incoming=page.locator('#owner-transfer-section'),accept=locale==='en'?'Accept handover':'Aceptar traspaso';await incoming.getByRole('button',{name:accept,exact:true}).waitFor();
   assert.ok(clock.reads>reads,'sign-in reads the controlled factor clock');
   await page.reload();await incoming.getByRole('button',{name:accept,exact:true}).waitFor();await page.locator('input[name=actionProofCode]').fill(actionTestTotp(secret,1,now.getTime()));
   reads=clock.reads;sessionReads=clock.sessionReads;
   await page.getByRole('button',{name:c.factorTotp,exact:true}).click();await page.getByText(c.actionProofReady,{exact:true}).waitFor();
   assert.ok(clock.reads>reads,'handover proof reads the controlled factor clock');
   assert.ok(clock.sessionReads>sessionReads,'handover proof checks session expiry against live time');
   factorClock=undefined;
   const step=Math.floor(now.getTime()/30_000);
   const replays=await pool.query<{time_step:string}>('SELECT time_step FROM cloud_factor_replays WHERE account_id=$1 ORDER BY time_step',[recipient]);
   assert.deepEqual(replays.rows.map(row=>Number(row.time_step)),[step-1,step,step+1]);
   await incoming.getByText(senderEmail,{exact:true}).waitFor();await incoming.getByRole('button',{name:accept,exact:true}).click();await incoming.getByText(locale==='en'?'Accepted':'Aceptado',{exact:true}).waitFor();await look('accepted');
   assert.equal((await f.db.pool.query('SELECT state FROM owner_transfers WHERE id=$1',[offer.id])).rows[0].state,'accepted');
   assert.deepEqual((await f.db.pool.query('SELECT account_id FROM organisation_memberships WHERE organisation_id=$1 AND is_owner',[sender.organisationId])).rows,[{account_id:recipient}]);
  }finally{factorClock=undefined;await sending.close();await context.close();}
 }}finally{
  pool.off('acquire',acquire);
  pool.off('release',release);
  for(const [client,query] of queries)client.query=query;
  await f.close();
 }
});

test('unavailable handover keeps the verified link usable for business signup in both languages',async()=>{
 const f=await startPortalFixture();
 try{for(const locale of ['en','es'] as const){
  await f.db.pool.query('DELETE FROM account_rate_limits');const context=await f.browser.newContext({locale}),c=translations[locale];
  try{
   const email=`no-offer-${randomUUID()}@example.test`,signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email,locale);
   const mail=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
   const page=await context.newPage();page.setDefaultTimeout(7000);await page.goto(`${f.origin}/signup#token=${mail.token}&lang=${locale}`);
   const choice=page.getByLabel(locale==='en'?"I'm receiving a business":'Estoy recibiendo un negocio',{exact:true});await choice.check();await page.locator('input[name=password]').fill(password);await page.locator('#submit').click();
   await page.getByText(locale==='en'?'No handover is waiting for this address. Your account has not been created. Create a business or ask the sender.':'No hay un traspaso pendiente para este correo. Tu cuenta no se ha creado. Crea un negocio o consulta con quien lo envió.',{exact:true}).waitFor();
   assert.equal(await page.getByText(c.linkUnavailable,{exact:true}).count(),0);
   await choice.uncheck();await page.locator('input[name=legalBusinessName]').fill('New Café');await page.locator('#submit').click();await page.getByText(c.signupReady,{exact:true}).waitFor();
   assert.equal((await f.db.pool.query('SELECT count(*) FROM organisation_memberships m JOIN cloud_credentials c ON c.account_id=m.account_id WHERE c.email=$1 AND m.is_owner',[email])).rows[0].count,'1');
  }finally{await context.close();}
 }}finally{await f.close();}
});
