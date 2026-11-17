import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {CloudActionWorker} from '../../../packages/registration/src/cloud-action-worker.ts';
import {openProofWindow} from '../../../packages/registration/test/fixtures/action-proof.ts';
import {startPortalFixture} from './fixtures.ts';
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
  f.loseAccountReply('/operator/actions/decide');
  await article.getByRole('button',{name:c.cloudActionsApprove,exact:true}).click();
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
