import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createSession,hashSecret} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {CloudActionWorker} from '../../../packages/registration/src/cloud-action-worker.ts';
import {openProofWindow} from '../../../packages/registration/test/fixtures/action-proof.ts';
import {completeBrowserEmail,mailFor,startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`approved action recovery ${locale} ${theme} ${width}: consoleLossPreservesPendingWork`,async()=>{
 const operator=randomUUID(),f=await startPortalFixture(undefined,undefined,undefined,undefined,false,undefined,operator);
 const directory=await mkdtemp(join(tmpdir(),'cloud-action-journey-'));
 const {openSyntheticWorkload}=await import(new URL('../../../deploy/test-cloud/cloud-action-demo.mjs',import.meta.url).href);
 let workload:Awaited<ReturnType<typeof openSyntheticWorkload>>|undefined;
 try{
  await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[operator]);
  await f.db.pool.query("INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,'operator@example.test','synthetic',clock_timestamp())",[operator]);
  const actor=await transaction(f.db.pool,c=>createSession(c,operator));await openProofWindow(f.db.pool,actor.token);
  const context=await f.browser.newContext({locale,colorScheme:theme,viewport:{width,height:1000}}),c=translations[locale];
  await context.addCookies([{name:'cloud_session',value:actor.token,url:f.origin,httpOnly:true},{name:'cloud_csrf',value:actor.csrfToken,url:f.origin}]);
  workload=await openSyntheticWorkload(directory,{CLOUD_ACTION_DEMO:'1'});const input=await workload.drain();
  let page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(f.origin+'/operator/actions');
  const form=page.locator('#cloud-proposal');await form.waitFor();
  await form.locator('select[name=actionId]').selectOption(input.actionId);
  for(const key of ['occurrence','cell','target','proposal','evidence'])await form.locator(`wt-input[name=${key}] input`).fill(input[key]);
  await form.getByRole('button',{name:c.cloudActionsSave,exact:true}).click();await page.getByRole('article').getByText(input.proposal,{exact:true}).waitFor();
  const saved=(await f.db.pool.query('SELECT * FROM cloud_action_requests')).rows[0];assert.equal(saved.policy,'ask-first');
  await page.close();
  const options={demo:true,operatorAccountId:operator,executor:workload};
  assert.equal(await new CloudActionWorker(f.db.pool,options).runOnce(),false);assert.equal((await workload.health()).healthy,true);
  page=await context.newPage();page.setDefaultTimeout(5000);await page.goto(f.origin+'/operator/actions');
  const article=page.getByRole('article');await article.getByText(input.proposal,{exact:true}).waitFor();
  assert.equal((await f.db.pool.query('SELECT id FROM cloud_action_requests')).rows[0].id,saved.id);
  await page.route('**/operator/actions/decide',async route=>{
   const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');
  });
  const lostReply=page.waitForEvent('requestfailed',request=>request.url().endsWith('/operator/actions/decide'));
  await article.getByRole('button',{name:c.cloudActionsApprove,exact:true}).click();
  assert.ok((await lostReply).failure(),'the committed approval reply must actually be lost');
  await article.getByText(c.cloudActionState_approved,{exact:true}).first().waitFor();
  const approved=(await f.db.pool.query('SELECT * FROM cloud_action_requests')).rows[0];
  assert.equal(approved.effect_id,saved.effect_id);assert.equal(approved.version,1);
  assert.equal((await f.db.pool.query("SELECT count(*) FROM cloud_action_events WHERE kind='approved'")).rows[0].count,'1');
  const execute=workload.restart.bind(workload);workload.restart=async (request:import('../../../packages/registration/src/cloud-action-store.ts').CloudActionRequest)=>{await execute(request);throw Error('controller stopped after effect');};
  await assert.rejects(new CloudActionWorker(f.db.pool,options).runOnce(),/controller stopped after effect/);
  await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();
  await article.getByText(locale==='en'?'Action dispatched; not yet confirmed. It will not be repeated.':'Acción enviada; aún sin confirmar. No se repetirá.',{exact:true}).waitFor();
  await workload.close();workload=await openSyntheticWorkload(directory,{CLOUD_ACTION_DEMO:'1'});const restarted=await workload.health();
  assert.equal(await new CloudActionWorker(f.db.pool,{...options,executor:workload}).runOnce(),true);
  assert.deepEqual(await workload.health(),restarted);
  await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();
  await article.getByText(locale==='en'?'Synthetic action confirmed':'Acción sintética confirmada',{exact:true}).waitFor();
  assert.equal(await article.getByRole('button').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.CLOUD_ACTION_SCREENSHOTS){await mkdir(process.env.CLOUD_ACTION_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.CLOUD_ACTION_SCREENSHOTS,`journey-${locale}-${theme}-${width}.png`),fullPage:true});}
 }finally{await workload?.close();await rm(directory,{recursive:true,force:true});await f.close();}
});

const venueScreens=process.env.CLOUD_OPERATOR_VENUE_SCREENSHOTS;
for(const locale of ['en','es'] as const)
for(const theme of (venueScreens?['light','dark']:['light']) as ('light'|'dark')[])
for(const width of venueScreens?[390,1280]:[390])test(`operator venue journey ${locale} ${theme} ${width}`,async()=>{
 const operator=randomUUID(),email=`operator-${operator}@example.test`,password='Synthetic operator password';
 const fixture=await startPortalFixture(undefined,undefined,undefined,undefined,false,undefined,{id:operator,venues:true});
 try{
  await fixture.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[operator]);
  await fixture.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())',
   [operator,email,await hashSecret(password)]);
  const organisation=randomUUID(),business=randomUUID(),venueId=randomUUID(),name='Café Lunar';
  await fixture.db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
  await fixture.db.pool.query("INSERT INTO legal_businesses(id,organisation_id,country_code) VALUES($1,$2,'ES')",[business,organisation]);
  await fixture.db.pool.query("INSERT INTO venues(id,environment,organisation_id,legal_business_id,display_name) VALUES($1,'test',$2,$3,$4)",
   [venueId,organisation,business,name]);
  const page=await fixture.browser.newPage({locale:'en',colorScheme:theme,viewport:{width,height:880}});
  page.setDefaultTimeout(5000);
  const find=locale==='en'?'Find a venue':'Buscar un local';
  const stop=locale==='en'?'Stop address suggestions':'Detener las sugerencias de direcciones';
  const allow=locale==='en'?'Allow address suggestions':'Permitir las sugerencias de direcciones';
  const c=translations[locale];
  const venuePath='/operator/venues';
  assert.equal((await page.goto(`${fixture.origin}${venuePath}#venue=${venueId}&lang=${locale}`))?.status(),200);
  await page.locator('wt-input[name=email] input').fill(email);
  await page.locator('wt-input[name=password] input').fill(password);
  await page.locator('#submit').click();
  await completeBrowserEmail(fixture,page,email,locale);
  await page.getByRole('heading',{name,exact:true,level:1}).waitFor();
  assert.equal(new URL(page.url()).pathname,venuePath);
  assert.equal(new URL(page.url()).hash,'');
  await page.goto(fixture.origin+'/operator/actions#lang='+locale);
  await page.getByRole('link',{name:find,exact:true}).click();
  const lookup=page.getByRole('searchbox',{name:locale==='en'?'Venue name':'Nombre del local'});
  const searchButton=page.getByRole('button',{name:locale==='en'?'Search':'Buscar',exact:true});
  const searchStyle=await searchButton.evaluate(button=>getComputedStyle(button).textDecorationLine);
  if(locale==='es')assert.equal(searchStyle,'none','Search is styled as a button');
  await lookup.fill('cafe lunar');
  if(locale==='en')await lookup.press('Enter');else await searchButton.click();
  const found=page.getByRole('link',{name,exact:true});
  await found.waitFor();
  const capture=async(state:string)=>{
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(venueScreens){
    await mkdir(venueScreens,{recursive:true});
    await page.screenshot({path:join(venueScreens,`${locale}-${theme}-${width}-${state}.png`),fullPage:true});
   }
  };
  await capture('search');
  await found.click();
  const stopButton=page.getByRole('button',{name:stop,exact:true}),allowButton=page.getByRole('button',{name:allow,exact:true});
  await stopButton.waitFor();
  await stopButton.click();
  const proof=page.getByRole('heading',{name:c.actionProofTitle,exact:true});
  await proof.waitFor();
  await page.getByRole('button',{name:c.actionProofEmail,exact:true}).click();
  const input=page.locator('wt-input[name=actionProofCode] input');
  await input.waitFor();
  await fixture.drainMail();
  const subject=locale==='en'?'Your Waitron Cloud verification code':'Tu código de verificación de Waitron Cloud';
  const proofMail=await mailFor(email,subject,fixture.mailEvidence);
  const code=proofMail.match(/^([0-9]{6})$/m)?.[1];assert.ok(code);
  await input.fill(code);
  await page.locator('#action-proof-verify').click();
  await proof.waitFor({state:'hidden'});
  assert.equal(await stopButton.evaluate(button=>(button.getRootNode() as Document|ShadowRoot).activeElement===button),true);
  assert.equal(searchStyle,'none','Search is styled as a button');
  await capture('allowed');
  await page.route('**/operator/venues/address-lookup',async route=>{
   const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');
  },{times:1});
  const lostReply=page.waitForEvent('requestfailed',request=>request.url().endsWith('/operator/venues/address-lookup'));
  await stopButton.click();
  assert.ok((await lostReply).failure());
  await allowButton.waitFor();
  await capture('stopped');
  await page.reload();
  await allowButton.click();
  await stopButton.waitFor();
  const {rows}=await fixture.db.pool.query("SELECT event_type FROM security_audit_events WHERE subject_id=$1 AND event_type<>'venue.viewed' ORDER BY occurred_at",[venueId]);
  assert.deepEqual(rows.map(row=>row.event_type),['venue.address_lookup_stopped','venue.address_lookup_allowed']);
  if(locale==='en'){
   await page.getByRole('combobox',{name:'Language'}).selectOption('es');
   await page.goBack();
   const spanish=page.getByRole('heading',{name:'Buscar un local',exact:true,level:1});
   await spanish.waitFor();
   await page.reload();
   await spanish.waitFor();
  }
 }finally{await fixture.close();}
});
