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
  child.once('error',()=>{exited=true;yes({code:null,signal:null,error:'spawn_failed'});});
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

export async function runTranslationProof(caseName,{failAfterLaunch=false}={}){
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
 const [{startPortalFixture},{SignupStore},{TranslationWorker,createOpenAiClient},{startFakeOpenAi,echoFirstPass,isReview,emptyReview,responsesBody},{DatabaseSync}]=await Promise.all([
  import('../apps/portal/test/fixtures.ts'),import('../packages/registration/src/index.ts'),import('../packages/translation/src/index.ts'),import('../packages/translation/test/fake-openai.ts'),import('node:sqlite'),
 ]);
 let f,context,provider,root,stage='setup',generation=0,workerWork;
 const children=[],releaseChecks=[],abort=new AbortController();
 const receipt={case:caseName,sources,passed:false,cleanup:{}};
 const snapshot=()=>{
  const db=new DatabaseSync(join(root,'venue/venue.db'),{readOnly:true});
  try{return {jobs:db.prepare('SELECT * FROM content_suggestion_jobs ORDER BY position').all(),suggestions:db.prepare('SELECT * FROM content_suggestions ORDER BY id').all()};}finally{db.close();}
 };
 const checked=async(task)=>Promise.race([task,f.translation.failure]);
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
  const assertStored=(state,count,refs)=>{
   const {jobs,suggestions}=state;assert.equal(jobs.length,1);const job=jobs[0];
   assert.equal(job.dropped,0,'translation dropped');assert.equal(job.released,0,'release precedes durable check');
   assert.equal(job.done,count);assert.equal(job.failed,0);assert.deepEqual(JSON.parse(job.failed_refs),[]);
   assert.deepEqual([...JSON.parse(job.collected_refs)].sort(),[...refs].sort());
   assert.equal(new Set(JSON.parse(job.collected_refs)).size,count);
   assert.equal(suggestions.length,count);assert.equal(new Set(suggestions.map(row=>row.id)).size,count);
   for(const row of suggestions){assert.equal(row.kind,'product');assert.equal(row.language,'en');assert.equal(row.text,expectedProducts.get(row.item_id));assert.equal(row.placeholder,0);assert.equal(row.fix_field,null);}
   return job;
  };
  f.translation.beforeRelease(async jobId=>{
   const state=snapshot(),job=assertStored(state,3,expectedRefs);
   assert.equal(job.cloud_job_id,jobId);assert.equal(job.state,'done');assert.equal(job.collect_cursor,null);
   releaseChecks.push({generation,durable:true,count:state.suggestions.length,dropped:job.dropped});
  });
  provider=await startFakeOpenAi(r=>{
   if(isReview(r))return emptyReview();
   const first=echoFirstPass(r),body=JSON.parse(first.json.output[0].content[0].text);
   for(const product of body.products)product.en=translated(product.en.replace(/ \[en\]$/,''));
   return {json:responsesBody(JSON.stringify(body))};
  });
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
  stage='worker';const worker=new TranslationWorker(f.db.pool,createOpenAiClient({apiKey:'synthetic-local-proof-key',baseUrl:provider.baseUrl}));
  workerWork=worker.runOnce(abort.signal);assert.equal(await checked(workerWork),true);
  assert.equal((await f.db.pool.query('SELECT state FROM translation_jobs WHERE id=$1',[cloudJob.id])).rows[0].state,'done');
  stage='collect';await checked(until(()=>{const job=snapshot().jobs[0];return job?.released===1&&job;},'released'));
  stage='suggestions';const suggestions=[];let after;
  do{
   const read=await request('GET','content-suggestions?language=en'+(after?'&after='+encodeURIComponent(after):''));
   assert.equal(read.run.state,'done');assert.equal(read.run.total,3);assert.equal(read.run.done,3);assert.equal(read.run.failed,0);assert.equal(read.run.progress,3);assert.equal(read.run.waiting,3);
   suggestions.push(...read.suggestions);after=read.next;
  }while(after);
  assert.equal(suggestions.length,3);assert.equal(new Set(suggestions.map(row=>row.id)).size,3);
  assert.equal(new Set(suggestions.map(row=>`${row.kind}:${row.itemId}:${row.language}`)).size,3);
  for(const row of suggestions){assert.equal(row.kind,'product');assert.equal(row.language,'en');assert.equal(row.text,expectedProducts.get(row.itemId));assert.equal(row.placeholder,false);assert.equal(row.fix,null);assert.equal(row.stale,false);}
  const cloudFinal=(await f.db.pool.query('SELECT state,collected_at,(SELECT count(*)::int FROM translation_job_bodies b WHERE b.job_id=j.id) AS bodies FROM translation_jobs j WHERE id=$1',[cloudJob.id])).rows[0];
  assert.equal(cloudFinal.state,'collected');assert.equal(cloudFinal.bodies,0);assert.ok(cloudFinal.collected_at);
  receipt.cloudFinal=cloudFinal;receipt.durableRelease=releaseChecks;receipt.suggestions={count:suggestions.length,unique:3,dropped:snapshot().jobs[0].dropped};
  await context.close();context=undefined;
  for(const running of children)assert.deepEqual(await running.stop(),{code:0,signal:null});
  verifyTranslationTrace(f.translation.events,{cursors:[0,1,2],releaseAttempts:1});
  const pages=f.translation.events.filter(e=>e.action==='translation-collect'&&e.kind==='reply');
  assert.equal(pages.length,3);assert.deepEqual(pages.map(e=>e.body.nextCursor),[1,2,null]);
  for(const [index,event] of pages.entries()){
   assert.equal(event.body.results.length,1);assert.deepEqual(event.body.failed,[]);assert.equal(event.body.results[0].ref,filtered[index].ref);
   assert.ok(Buffer.byteLength(JSON.stringify(event.body))<=512);
   if(index<2)assert.ok(Buffer.byteLength(JSON.stringify({...event.body,results:[...event.body.results,...pages[index+1].body.results],nextCursor:pages[index+1].body.nextCursor}))>512);
  }
  receipt.events=f.translation.events.map(event=>({kind:event.kind,action:event.action,jobId:event.jobId,installationId:event.installationId,cursor:event.cursor,generation:1,...(event.kind==='request'?{}:{status:event.status,nextCursor:event.body.nextCursor,bodyHash:digest(event.body)})}));
  receipt.passed=true;
 }catch(error){receipt.failure={stage,code:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'translation_proof_'+stage+'_failed'};throw Object.assign(new Error(`translation_proof_failed_${stage}`),{receipt});}
 finally{
  abort.abort();if(workerWork)await Promise.allSettled([workerWork]);
  for(const running of children)await running.stop();
  await context?.close();await provider?.close();await f?.close();
  if(root)await rm(root,{recursive:true,force:true});
  receipt.cleanup={rootRemoved:!!root,children:children.map(r=>({pid:r.child.pid,exited:r.exited})),fixtureClosed:!!f,providerClosed:!!provider};
 }
 return receipt;
}

export function verifyTranslationTrace(events,expected){
 assert.ok(events.length,'translation trace missing');
 const binding=events[0],cursors=[];
 let continuation=0,pending,final=false,releases=0,releaseLost=false,expired=false;
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
   if(event.status===410){assert.deepEqual(event.body,{error:'translation_expired'});expired=true;}
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
 assert.ok(releases>0?!releaseLost:expired,'translation final reply missing');
}

async function main(args){
 if(args.length!==2||args[0]!=='--case'||args[1]!=='baseline')throw new Error('translation_proof_arguments_invalid');
 let receipt;
 try{receipt=await runTranslationProof(args[1]);}
 catch(error){if(error.receipt&&process.env.TRANSLATION_RECEIPT)await writeFile(process.env.TRANSLATION_RECEIPT,JSON.stringify(error.receipt,null,2)+'\n');throw error;}
 if(process.env.TRANSLATION_RECEIPT)await writeFile(process.env.TRANSLATION_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
