import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile,access,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export function trackTranslationChild(child){
 let exited=false;
 const done=new Promise(yes=>{
  child.once('exit',(code,signal)=>{exited=true;yes({code,signal});});
  child.on('error',()=>{if(child.pid!==undefined)return;exited=true;yes({code:null,signal:null,error:'spawn_failed'});});
 });
 void done.catch(()=>{});
 return {child,done,get exited(){return exited;},async stop(signal='SIGTERM'){
  if(exited)return done;
  child.kill(signal);
  const timer=setTimeout(()=>{if(!exited)child.kill('SIGKILL');},5000);
  try{return await done;}finally{clearTimeout(timer);}
 }};
}

const identity=path=>({head:execFileSync('git',['-C',path,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['-C',path,'status','--porcelain'],{encoding:'utf8'}).trim()!==''});
const translated=name=>name.padEnd(180,'x');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function until(read,label,timeout=60000){
 const end=Date.now()+timeout;
 while(Date.now()<end){const value=await read();if(value)return value;await delay(100);}
 throw new Error(`translation_proof_timeout_${label}`);
}

export async function runTranslationProof(caseName,{failAfterLaunch=false,readFinishedBeforeAlert=false}={}){
 const expiry=caseName==='expiry',suggestionCount=expiry?1:3,releaseAttempts=expiry?0:caseName==='lost-release'?2:1;
 const restartSignal=caseName==='restart-term'?'SIGTERM':caseName==='restart-kill'?'SIGKILL':undefined;
 const checkout=process.env.WAITRON_CHECKOUT;
 assert.ok(checkout,'translation_proof_waitron_checkout_required');
 const waitron=resolve(checkout),cloud=resolve(import.meta.dirname,'..');
 const sources={cloud:identity(cloud),waitron:identity(waitron)};
 assert.equal(sources.waitron.dirty,false,'translation_proof_waitron_dirty');
 const fixturePath=join(waitron,'apps/server/scripts/cloud-integration-fixture.ts');
 await access(fixturePath);await access(join(waitron,'apps/dashboard/dist/index.html'));
 const bundleFiles=(await readdir(join(waitron,'apps/dashboard/dist/assets'))).filter(name=>name.endsWith('.js'));
 const bundles=await Promise.all(bundleFiles.map(name=>readFile(join(waitron,'apps/dashboard/dist/assets',name),'utf8')));
 assert.ok(bundles.some(text=>text.includes('content.suggestions_ready_partly')&&text.includes("couldn't be done this time")),'translation_proof_current_dashboard_required');
 const require=createRequire(join(waitron,'apps/server/package.json')),tsx=require.resolve('tsx');
 const [{startPortalFixture},{SignupStore},{TranslationWorker,createLoopbackOpenAiClient,sweepTranslationJobs},{startFakeOpenAi,echoFirstPass,isReview,emptyReview,responsesBody},{DatabaseSync}]=await Promise.all([
  import('../apps/portal/test/fixtures.ts'),import('../packages/registration/src/index.ts'),import('../packages/translation/src/index.ts'),import('../packages/translation/test/fake-openai.ts'),import('node:sqlite'),
 ]);
 let f,context,provider,root,stage='setup',generation=0,workerWork,loss,gate,firstSuggestion,releaseSnapshot;
 const children=[],releaseChecks=[],abort=new AbortController();
 const receipt={case:caseName,sources,passed:false,cleanup:{}};
 const safeEvents=()=>f?.translation.events.map(event=>({kind:event.kind,action:event.action,jobId:event.jobId,installationId:event.installationId,cursor:event.cursor,generation:event.generation,...(event.kind==='request'?{}:{status:event.status,nextCursor:event.body?.nextCursor,bodyHash:digest(event.body)})}));
 const snapshot=()=>{
  const db=new DatabaseSync(join(root,'venue/venue.db'),{readOnly:true});
  try{return {jobs:db.prepare('SELECT * FROM content_suggestion_jobs ORDER BY position').all(),suggestions:db.prepare('SELECT * FROM content_suggestions ORDER BY id').all()};}finally{db.close();}
 };
 const checked=task=>awaitTranslationWork(task,f.translation.failure);
 const cloudState=async jobId=>(await f.db.pool.query('SELECT state,collected_at,(SELECT count(*)::int FROM translation_job_bodies b WHERE b.job_id=j.id) AS bodies FROM translation_jobs j WHERE id=$1',[jobId])).rows[0];
 const launch=async()=>{
  await rm(join(root,'ready.json'),{force:true});generation++;
  const child=spawn(process.execPath,['--import',tsx,fixturePath],{cwd:join(waitron,'apps/server'),env:{...process.env,CLOUD_TEST_ROOT:root,CLOUD_TEST_ORIGIN:f.origin},stdio:['ignore','ignore','pipe','ipc']});
  let diagnostics='';child.stderr.on('data',bytes=>{diagnostics=(diagnostics+bytes.toString()).slice(-16000);});
  const running=trackTranslationChild(child);running.generation=generation;children.push(running);
  const ready=await until(async()=>{
   if(running.exited){
    receipt.childFailure={exit:await running.done,codes:[...new Set(diagnostics.match(/\b(?:ERR_[A-Z_]+|SQLITE_[A-Z_]+)\b/g)??[])],applicationCodes:[...diagnostics.matchAll(/\b(?:code|reason): ['"]([a-z][a-z0-9_.-]{0,99})['"]/g)].map(match=>match[1]),messages:diagnostics.split('\n').filter(line=>/^Error: (?:Cannot find|Could not locate|No native build|Module did not|Disposable Cloud fixture)/.test(line)).map(line=>line.slice(0,300)),frames:diagnostics.split('\n').filter(line=>/^\s+at /.test(line)).slice(0,5).map(line=>line.slice(0,300))};
    throw new Error('translation_proof_waitron_exited');
   }
   try{return JSON.parse(await readFile(join(root,'ready.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  },'ready',30000);
  return {...ready,running};
 };
 try{
  f=await startPortalFixture(undefined,undefined,undefined,undefined,{pageBytes:512});
  f.translation.events.push=(...events)=>Array.prototype.push.apply(f.translation.events,events.map(event=>({...event,generation})));
  root=await mkdtemp(join(tmpdir(),'cloud-integration-translation-'));receipt.root=root;
  stage='launch';const server=await launch();
  if(failAfterLaunch)throw new Error('translation_proof_injected_setup_failure');
  stage='account';const signup=new SignupStore(f.db.pool,f.db.outbox),email=`translation-${randomUUID()}@example.test`,password='Cloud translation proof password';
  await signup.request(email);
  const mail=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0]);assert.ok('token' in mail);
  await signup.complete(mail.token,{password,organisationName:'Translation Proof',legalBusinessName:'Translation Proof SL',countryCode:'ES'});
  context=await f.browser.newContext({locale:'en',viewport:{width:1280,height:900}});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const request=async(method,path,data,status=200)=>{
   const response=await context.request.fetch(server.origin+'/management-api/'+path,{method,headers:{origin:server.origin},...(data===undefined?{}:{data})});
   assert.equal(response.status(),status,`translation_proof_route_${method}_${path.split('?')[0]}_${response.status()}`);
   return status===204?null:response.json();
  };
  stage='pairing';await request('POST','session',{email:'owner@example.test',password:'Local integration password'});
  await page.goto(server.origin+'/manage/cloud');await page.getByRole('button',{name:'Connect to Cloud',exact:true}).click();
  const localScreen=page.locator('dashboard-cloud-services-screen');await localScreen.locator('.code').waitFor();
  const code=(await localScreen.locator('.code').innerText()).trim();assert.match(code,/^\d{8}$/);
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Open Cloud',exact:true}).click();const portal=await popupPromise;portal.setDefaultTimeout(15000);
  await portal.getByLabel('Email').fill(email);await portal.locator('input[name=password]').fill(password);await portal.getByRole('button',{name:'Sign in',exact:true}).click();
  await portal.getByRole('textbox',{name:'Code shown in Waitron',exact:true}).fill(code);await portal.getByRole('button',{name:'Check code',exact:true}).click();
  await portal.getByText(server.localVenueId,{exact:true}).waitFor();await portal.getByRole('button',{name:'Approve this venue',exact:true}).click();await portal.getByText('Approved in Cloud.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Check connection',exact:true}).click();await page.getByText('Translation Proof SL',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Connect this venue',exact:true}).click();await page.getByText('Connected',{exact:true}).waitFor();
  const connected=await request('GET','cloud/status');receipt.installationId=connected.registration.installationId;
  stage='consent';await portal.goto(f.origin+'/account');await portal.getByRole('button',{name:'Allow menu translation',exact:true}).click();
  await portal.getByText('Menu translation is allowed for this venue.',{exact:true}).waitFor();
  const consents=await (await context.request.get(f.origin+'/api/account/translation-consent')).json();
  receipt.consent={venueId:connected.registration.venueId,consents:consents.consents};
  assert.ok(consents.consents.some(row=>row.venueId===connected.registration.venueId&&row.consented===true),'translation_proof_consent_saved');
  await request('POST','cloud/refresh',{});
  // A fresh connection renews its lease before it can request version-2 configuration.
  await request('POST','cloud/refresh',{});
  const configured=await request('GET','cloud/status');receipt.services=configured.installation.services;assert.ok(configured.installation.services.some(row=>row.service==='content_translation'&&row.state==='ready'),'translation_proof_service_ready');
  const available=await request('GET','content-suggestions?language=en');assert.equal(available.service,'on');assert.equal(available.cloudOrigin,f.origin);
  stage='content';await request('PUT','content-languages',{defaultLanguage:'es',languages:['es','en']},204);
  const languages=await request('GET','content-languages');receipt.languages=languages;assert.equal(languages.defaultLanguage,'es');assert.deepEqual(languages.languages,['es','en']);
  await request('GET','content-language-rules');
  const existingMenus=await request('GET','catalogues');
  assert.equal(existingMenus.length,1,'translation_proof_initial_menu');
  await request('PATCH',`catalogues/${existingMenus[0].id}`,{names:{es:'Menú inicial',en:'Initial menu'}},204);
  const catalogue=await request('POST','catalogues',{name:'Interruption menu',names:{es:'Menú de prueba',en:'Test menu'}},201);
  const expectedProducts=new Map();
  for(let index=1;index<=3;index++){
   const name=`Proof coffee ${index}`,product=await request('POST','products',{catalogueId:catalogue.id,categoryId:null,name,customerName:{es:`Café de prueba ${index}`},pricingUnit:'each',unitPrice:'2.00',vatClass:'general'},201);
   expectedProducts.set(product.id,translated(name));
  }
  const gaps=await request('GET','content-translation-gaps');
  const expectedRefs=[...expectedProducts.keys()].map(id=>'product:'+id).sort();
  receipt.gaps=gaps.map(row=>({language:row.language,refs:row.gaps.map(gap=>`${gap.kind}:${gap.id}`)}));
  assert.deepEqual(gaps.map(row=>row.language),['es','en']);
  assert.deepEqual(gaps.find(row=>row.language==='es').gaps,[]);
  assert.deepEqual(gaps.find(row=>row.language==='en').gaps.map(row=>`${row.kind}:${row.id}`).sort(),expectedRefs);
  const assertStored=(state,count,refs,cursor=null,jobState='done')=>{
   assert.equal(refs.length,count);
   return verifyTranslationStorage(state,{refs,translations:[...expectedProducts],cursor,state:jobState});
  };
  f.translation.beforeRelease(async jobId=>{
   const state=snapshot(),job=assertStored(state,3,expectedRefs);
   assert.equal(job.cloud_job_id,jobId);assert.equal(job.state,'done');assert.equal(job.collect_cursor,null);
   if(releaseChecks.length){
    assert.ok(releaseSnapshot,'first release snapshot missing');
    await verifyTranslationRepeat(releaseSnapshot,()=>cloudState(jobId));
    receipt.firstSnapshotBeforeRetry=true;
   }
   releaseChecks.push({generation,durable:true,count:state.suggestions.length,dropped:job.dropped});
  });
  provider=await startFakeOpenAi(r=>{
   if(isReview(r))return emptyReview();
   const first=echoFirstPass(r),body=JSON.parse(first.json.output[0].content[0].text);
   for(const product of body.products)product.en=translated(product.en.replace(/ \[en\]$/,''));
   return {json:responsesBody(JSON.stringify(body))};
  });
  if(caseName==='lost-page')loss=f.translation.loseReply('translation-collect',1);
  if(caseName==='lost-release'){
   loss=f.translation.loseReply('translation-release');
   releaseSnapshot=loss.then(async()=>{const row=await cloudState(receipt.jobId);verifyTranslationDeletion(row);receipt.releaseCommitted=row;return row;});
   void releaseSnapshot.catch(()=>{});
  }
  if(restartSignal||expiry)gate=f.translation.pauseCollect(1);
  stage='start';const started=await request('POST','content-suggestions/jobs',{});assert.equal(started.run.state,'sending');assert.equal(started.run.total,3);
  const cloudJob=await checked(until(async()=>{
   const rows=(await f.db.pool.query('SELECT * FROM translation_jobs WHERE installation_id=$1',[receipt.installationId])).rows;
   return rows.length===1&&rows[0].state==='queued'?rows[0]:undefined;
  },'submit'));
  const saved=(await f.db.pool.query('SELECT body FROM translation_job_bodies WHERE job_id=$1',[cloudJob.id])).rows[0];
  const submitted=JSON.parse(saved.body),filtered=submitted.items.filter(item=>item.missing.length>0);
  assert.equal(filtered.length,3);assert.deepEqual(filtered.map(item=>item.ref).sort(),expectedRefs);
  assert.ok(filtered.every(item=>JSON.stringify(item.missing)==='["en"]'));
  receipt.jobId=cloudJob.id;receipt.filteredRefs=filtered.map(item=>item.ref);
  stage='worker';const worker=new TranslationWorker(f.db.pool,createLoopbackOpenAiClient({apiKey:'synthetic-local-proof-key',baseUrl:provider.baseUrl}));
  workerWork=worker.runOnce(abort.signal);assert.equal(await checked(workerWork),true);
  assert.equal((await f.db.pool.query('SELECT state FROM translation_jobs WHERE id=$1',[cloudJob.id])).rows[0].state,'done');
  if(gate){
   stage=expiry?'expiry':'restart';assert.deepEqual(await checked(gate.entered),{jobId:cloudJob.id,cursor:1});
   const state=snapshot(),first=filtered[0].ref;
   receipt.boundary={state:state.jobs[0].state,cursor:state.jobs[0].collect_cursor,done:state.jobs[0].done,failed:state.jobs[0].failed,dropped:state.jobs[0].dropped,released:state.jobs[0].released,refs:JSON.parse(state.jobs[0].collected_refs),count:state.suggestions.length};
   assertStored(state,1,[first],1,'running');
   firstSuggestion=state.suggestions[0];
   if(expiry){
    const updated=await f.db.pool.query("UPDATE translation_jobs SET finished_at=clock_timestamp()-interval '25 hours' WHERE id=$1 AND state='done'",[cloudJob.id]);assert.equal(updated.rowCount,1);
    assert.deepEqual(await sweepTranslationJobs(f.db.pool),{expired:1});
    const expired=await cloudState(cloudJob.id);assert.equal(expired.state,'expired');assert.equal(expired.bodies,0);assert.equal(expired.collected_at,null);
    receipt.expiry={cloud:expired,firstSuggestion:{id:firstSuggestion.id,itemId:firstSuggestion.item_id,textHash:digest(firstSuggestion.text)}};
    gate.resume();
   }else{
   const exit=await server.running.stop(restartSignal);
   const expectedExit=restartSignal==='SIGKILL'?{code:null,signal:'SIGKILL'}:{code:0,signal:null};
   assert.deepEqual(exit,expectedExit);server.running.expectedExit=expectedExit;
   gate.cancel();
   await checked(until(()=>f.translation.events.find(event=>event.kind==='reply'&&event.cursor===1&&event.status===503&&event.generation===1),'cancelled_collect'));
   receipt.restart={signal:restartSignal,exit,boundary:{cursor:state.jobs[0].collect_cursor,refs:JSON.parse(state.jobs[0].collected_refs),count:state.suggestions.length,dropped:state.jobs[0].dropped}};
   const resumed=await launch();assert.equal(resumed.origin,server.origin);assert.equal(resumed.localVenueId,server.localVenueId);
   await checked(until(()=>f.translation.events.find(event=>event.kind==='request'&&event.action==='translation-collect'&&event.generation===2),'resumed_collect'));
   receipt.restart.firstCursor=verifyTranslationResume(f.translation.events);
   }
  }
  if(loss){
   const lost=await checked(loss);assert.equal(lost.status,200);receipt.lostReply={status:lost.status,bodyHash:digest(JSON.parse(lost.body))};
   if(caseName==='lost-release')await checked(releaseSnapshot);
  }
  stage='collect';await checked(until(()=>{const job=snapshot().jobs[0];return job?.released===1&&job;},'released'));
  if(expiry){
   stage='notification';const ended=snapshot();verifyTranslationExpiry(ended,firstSuggestion,receipt.filteredRefs);
   if(readFinishedBeforeAlert)await request('GET','content-suggestions?language=en');
   const alerts=await request('GET','alerts');
   receipt.expiry.alert=verifyTranslationNotification(alerts,ended.jobs[0].finished_at);
   const bell=page.locator('dashboard-alerts-bell');await bell.getByRole('button').first().click();
   await bell.getByText("Translations ready: 1 suggestions are waiting for review. 2 couldn't be done this time.",{exact:true}).waitFor();
   receipt.expiry.bellChecked=true;
  }
  stage='suggestions';const suggestions=[];let after;
  do{
   const read=await request('GET','content-suggestions?language=en'+(after?'&after='+encodeURIComponent(after):''));
   assert.equal(read.run.state,expiry?'expired':'done');assert.equal(read.run.total,3);assert.equal(read.run.done,suggestionCount);assert.equal(read.run.failed,expiry?2:0);assert.equal(read.run.progress,3);assert.equal(read.run.waiting,suggestionCount);
   if(expiry)assert.equal(read.run.code,'content.suggestion_expired');
   suggestions.push(...read.suggestions);after=read.next;
  }while(after);
  assert.equal(suggestions.length,suggestionCount);assert.equal(new Set(suggestions.map(row=>row.id)).size,suggestionCount);
  assert.equal(new Set(suggestions.map(row=>`${row.kind}:${row.itemId}:${row.language}`)).size,suggestionCount);
  if(expiry){assert.equal(suggestions[0].id,firstSuggestion.id);assert.equal(suggestions[0].text,firstSuggestion.text);}
  for(const row of suggestions){assert.equal(row.kind,'product');assert.equal(row.language,'en');assert.equal(row.text,expectedProducts.get(row.itemId));assert.equal(row.placeholder,false);assert.equal(row.fix,null);assert.equal(row.stale,false);}
  const cloudFinal=await cloudState(cloudJob.id);
  if(expiry){assert.equal(cloudFinal.state,'expired');assert.equal(cloudFinal.bodies,0);assert.equal(cloudFinal.collected_at,null);}else verifyTranslationDeletion(cloudFinal,receipt.releaseCommitted?.collected_at);
  receipt.cloudFinal=cloudFinal;receipt.durableRelease=releaseChecks;receipt.suggestions={count:suggestions.length,unique:suggestionCount,dropped:snapshot().jobs[0].dropped};
  await context.close();context=undefined;
  for(const running of children)assert.deepEqual(await running.stop(),running.expectedExit??{code:0,signal:null});
  verifyTranslationTrace(f.translation.events,{cursors:expiry?[0,1]:(caseName==='lost-page'||restartSignal)?[0,1,1,2]:[0,1,2],releaseAttempts,...(restartSignal?{cancelled:{generation:1,cursor:1}}:{})});
  assert.equal(releaseChecks.length,releaseAttempts,'durable check at every release');
  const pages=f.translation.events.filter(e=>e.action==='translation-collect'&&e.kind==='reply'&&e.status===200);
  assert.equal(pages.length,suggestionCount);assert.deepEqual(pages.map(e=>e.body.nextCursor),expiry?[1]:[1,2,null]);
  for(const [index,event] of pages.entries()){
   assert.equal(event.body.results.length,1);assert.deepEqual(event.body.failed,[]);assert.equal(event.body.results[0].ref,filtered[index].ref);
   assert.ok(Buffer.byteLength(JSON.stringify(event.body))<=512);
   if(index+1<pages.length)assert.ok(Buffer.byteLength(JSON.stringify({...event.body,results:[...event.body.results,...pages[index+1].body.results],nextCursor:pages[index+1].body.nextCursor}))>512);
  }
  receipt.events=safeEvents();
  receipt.passed=true;
 }catch(error){receipt.events=safeEvents();receipt.failure={stage,code:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'translation_proof_'+stage+'_failed'};throw Object.assign(new Error(`translation_proof_failed_${stage}`),{receipt});}
 finally{
  gate?.cancel();abort.abort();if(workerWork)await Promise.allSettled([workerWork]);
  for(const running of children)await running.stop();
  await context?.close();await provider?.close();await f?.close();
  if(root)await rm(root,{recursive:true,force:true});
  receipt.cleanup={rootRemoved:!!root,children:children.map(r=>({pid:r.child.pid,exited:r.exited})),fixtureClosed:!!f,providerClosed:!!provider};
 }
 return receipt;
}

export function verifyTranslationStorage(stored,expected){
 const {jobs,suggestions}=stored,count=expected.refs.length,translations=new Map(expected.translations);
 assert.equal(jobs.length,1);const job=jobs[0];
 assert.equal(job.dropped,0,'translation dropped');assert.equal(job.released,0,'release precedes durable check');
 if(expected.state==='done')assert.equal(job.done,count);
 assert.equal(job.failed,0);assert.deepEqual(JSON.parse(job.failed_refs),[]);
 assert.deepEqual([...JSON.parse(job.collected_refs)].sort(),[...expected.refs].sort());
 assert.equal(new Set(JSON.parse(job.collected_refs)).size,count);
 assert.equal(suggestions.length,count);assert.equal(new Set(suggestions.map(row=>row.id)).size,count);
 assert.deepEqual(suggestions.map(row=>`${row.kind}:${row.item_id}`).sort(),[...expected.refs].sort(),'durable products');
 for(const row of suggestions){assert.equal(row.kind,'product');assert.equal(row.language,'en');assert.equal(row.text,translations.get(row.item_id));assert.equal(row.placeholder,0);assert.equal(row.fix_field,null);}
 assert.equal(job.collect_cursor,expected.cursor,'durable continuation');assert.equal(job.state,expected.state,'durable state');
 return job;
}

export function verifyTranslationDeletion(row,previousCollectedAt){
 assert.equal(row.state,'collected');assert.equal(row.bodies,0,'Cloud body deletion');assert.ok(row.collected_at);
 if(previousCollectedAt!==undefined)assert.equal(new Date(row.collected_at).toISOString(),new Date(previousCollectedAt).toISOString(),'repeat release preserves collection time');
}

export async function verifyTranslationRepeat(committed,readCurrent){
 const first=await committed;verifyTranslationDeletion(first);
 verifyTranslationDeletion(await readCurrent(),first.collected_at);
}

export function verifyTranslationExpiry(stored,first,refs){
 assert.equal(stored.jobs.length,1);const job=stored.jobs[0];
 assert.equal(job.state,'expired');assert.equal(job.done,1);assert.equal(job.failed,2);assert.equal(job.dropped,0);assert.equal(job.released,1);assert.equal(job.collect_cursor,1);
 assert.deepEqual(JSON.parse(job.collected_refs),[refs[0]]);
 assert.deepEqual(JSON.parse(job.failed_refs).sort(),refs.slice(1).sort());
 assert.equal(stored.suggestions.length,1);assert.equal(stored.suggestions[0].id,first.id,'retained suggestion identity');assert.equal(stored.suggestions[0].text,first.text,'retained suggestion text');assert.equal(stored.suggestions[0].item_id,first.item_id);
}

export function verifyTranslationNotification(response,finishedAt){
 assert.equal(response.visible,true);const alert=response.alerts.find(row=>row.key==='content.suggestions_ready');
 assert.ok(alert,'partial translation notification');
 for(const [key,value] of Object.entries({kind:'ongoing',area:'content',severity:'notice',code:'content.suggestions_ready_partly',screen:'content-languages'}))assert.equal(alert[key],value);
 assert.deepEqual(alert.params,{count:1,failed:2});assert.ok(alert.since);assert.equal(alert.since,finishedAt);return alert;
}

export function verifyTranslationResume(events){
 const first=events.find(event=>event.kind==='request'&&event.action==='translation-collect'&&event.generation===2);
 assert.ok(first,'new generation collect missing');assert.equal(first.cursor,1,'new generation resumes durable cursor');return first.cursor;
}

export async function awaitTranslationWork(task,failure,timeout=150000){
 let timer;
 try{return await Promise.race([task,failure,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('translation_proof_timeout_work')),timeout);})]);}
 finally{clearTimeout(timer);}
}

export function verifyTranslationTrace(events,expected){
 assert.ok(events.length,'translation trace missing');
 const binding=events[0],cursors=[];
 let continuation=0,pending,final=false,releases=0,releaseLost=false,expired=false,cancellations=0;
 const lostPages=new Map();
 for(const event of events){
  assert.equal(event.jobId,binding.jobId,'translation binding');
  assert.equal(event.installationId,binding.installationId,'translation binding');
  if(event.kind==='request'){
   if(event.action==='translation-collect'){
    assert.equal(releases,0,'collect after release');
    assert.equal(event.cursor,continuation,'translation continuation');
    if(pending)assert.equal(pending.action,'translation-collect','unanswered request');
    assert.equal(final,false,'collect after final reply');
    assert.equal(expired,false,'collect after expiry');cursors.push(event.cursor);
   }else{
    assert.equal(event.action,'translation-release','translation action');
    assert.ok(final&&!pending,'release needs final null-cursor reply');
    assert.ok(releases===0||releaseLost,'release retry needs lost reply');
    releases++;releaseLost=false;
   }
   pending=event;continue;
  }
  assert.ok(pending,'reply needs request');
  assert.equal(event.action,pending.action,'reply needs matching request');
  assert.ok(event.kind==='reply'||event.kind==='lost','translation reply kind');
  if(event.action==='translation-collect'){
   assert.equal(event.cursor,pending.cursor,'reply cursor');
   if(event.status===503){
    assert.ok(expected.cancelled,'unexpected cancelled collect');
    assert.equal(cancellations,0,'duplicate cancellation');assert.equal(event.generation,expected.cancelled.generation,'cancelled generation');assert.equal(pending.generation,event.generation,'cancelled request generation');assert.equal(event.cursor,expected.cancelled.cursor,'cancelled cursor');
    assert.deepEqual(event.body,{error:'temporarily_unavailable'});cancellations++;
   }else if(event.status===410){assert.deepEqual(event.body,{error:'translation_expired'});expired=true;}
   else{
    assert.equal(event.status,200,'collect reply status');
    assert.equal(event.body.jobId,binding.jobId,'translation binding');
    const next=event.body.nextCursor;
    assert.ok(next===null||(Number.isSafeInteger(next)&&next>event.cursor),'translation continuation');
    if(lostPages.has(event.cursor))assert.deepEqual(event.body,lostPages.get(event.cursor),'same-cursor retry body');
    if(event.kind==='lost')lostPages.set(event.cursor,event.body);
    else{continuation=next;final=next===null;}
   }
  }else{
   assert.equal(event.status,200,'release reply status');
   assert.deepEqual(event.body,{version:1,jobId:binding.jobId,state:'collected'},'release reply');releaseLost=event.kind==='lost';
  }
  pending=undefined;
 }
 assert.equal(pending,undefined,'request has no reply');
 assert.deepEqual(cursors,expected.cursors,'translation cursor attempts');
 assert.equal(releases,expected.releaseAttempts,'translation release attempts');
 assert.equal(cancellations,expected.cancelled?1:0,'translation cancellation missing');
 assert.ok(releases>0?!releaseLost:expired,'translation final reply missing');
}

const faultCases=['lost-page','restart-term','restart-kill','lost-release','expiry'];
export function verifyTranslationCases(cases){
 assert.deepEqual(cases.map(row=>row.case),faultCases,'translation independent cases');
 assert.ok(cases.every(row=>row.passed===true),'translation fault case failed');
}
async function main(args){
 if(args.length!==0&&(args.length!==2||args[0]!=='--case'||!['baseline',...faultCases].includes(args[1])))throw new Error('translation_proof_arguments_invalid');
 let receipt;
 try{
  if(args.length)receipt=await runTranslationProof(args[1]);
  else{const cases=[];for(const name of faultCases){console.error(`translation proof: ${name}`);cases.push(await runTranslationProof(name));}verifyTranslationCases(cases);receipt={cases,passed:true};}
 }
 catch(error){if(error.receipt&&process.env.TRANSLATION_RECEIPT)await writeFile(process.env.TRANSLATION_RECEIPT,JSON.stringify(error.receipt,null,2)+'\n');throw error;}
 if(process.env.TRANSLATION_RECEIPT)await writeFile(process.env.TRANSLATION_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
