import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import axe from 'axe-core';
import {admitPointFixture} from '../../../packages/backups/test/fixtures/verification.ts';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {completeBrowserEmail,startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
import {backupBytes, backupManifest, recoveryKey, venueDatabase} from './fixtures/backup-download.ts';
for(const locale of ['en','es'] as const)test(`${locale} owner browses snapshot history at phone width`,async()=>{
 const f=await startPortalFixture();try{
  const email='backups@example.test',password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const v=await r.complete(b);
  const viewport={width:375,height:812};
  const context=await f.browser.newContext({locale,timezoneId:'Europe/Madrid',colorScheme:'light',viewport}),page=await context.newPage();page.setDefaultTimeout(4000);const c=translations[locale];
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await completeBrowserEmail(f,page,email,locale);
  await page.waitForURL(f.origin+'/account');await page.goto(f.origin+'/account/venues');
  const browse=locale==='en'?'View snapshots':'Ver instantáneas',refresh=locale==='en'?'Latest snapshots':'Últimas instantáneas',older=locale==='en'?'Older snapshots':'Instantáneas anteriores',choose=locale==='en'?'Choose a snapshot':'Elige una instantánea';
  await page.getByRole('button',{name:browse,exact:true}).click();await page.getByText(locale==='en'?'No snapshots have been stored for this venue.':'No se han guardado instantáneas de este local.',{exact:true}).waitFor();
  await f.db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://store.test','catalogue-browser','local')",[v.venueId,v.installationId]);await f.db.pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'unusable-fixture')",[v.venueId]);
  let verifiedId='';
  for(let n=0;n<52;n++){
   const id=randomUUID();if(n===1)verifiedId=id;await f.db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[id,v.venueId,v.installationId]);
   await f.db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification) VALUES($1,$2,$3,1,'snapshot',$4,$5,100,clock_timestamp()-($6::text||' days')::interval,'daily',$7,jsonb_build_object('core',1),$8)",[id,v.venueId,v.installationId,'snapshots/'+id,'a'.repeat(64),n,randomUUID(),n===1?'verified':'pending']);
  }
  await admitPointFixture(f.db.pool,verifiedId);
  await page.getByRole('button',{name:refresh,exact:true}).click();const choices=page.getByLabel(choose,{exact:true});await choices.waitFor();assert.equal(await choices.locator('option').count(),50);assert.equal(await choices.inputValue(),verifiedId);
  await page.getByText(locale==='en'?'Verified':'Verificada',{exact:true}).waitFor();await choices.selectOption({index:0});await page.getByText(locale==='en'?'Awaiting verification':'Pendiente de verificación',{exact:true}).waitFor();
  await page.getByText(locale==='en'?'To restore a snapshot, open the Cloud recovery link from the replacement server’s setup screen.':'Para restaurar una instantánea, abre el enlace de recuperación de Cloud desde la configuración del servidor de sustitución.',{exact:true}).waitFor();
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);await page.screenshot({path:new URL(`../dist/backups-${locale}.png`,import.meta.url).pathname,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,width:e.getBoundingClientRect().width})))));
  await page.getByRole('button',{name:older,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#snapshot-choice option').length===2);assert.equal(await page.getByRole('button',{name:older,exact:true}).count(),0);
  await page.getByRole('button',{name:refresh,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#snapshot-choice option').length===50);
  const saveDatabase=page.getByRole('button',{name:locale==='en'?'Download database':'Descargar base de datos',exact:true});
  const saveArchive=page.getByRole('button',{name:locale==='en'?'Download backup':'Descargar copia',exact:true});
  assert.equal(await saveArchive.count(),0);
  const effectiveEndAt='2026-01-01T12:00:00.000Z',deadlineAt='2026-04-01T12:00:00.000Z';
  const endedLabel=locale==='en'?'Service ended (UTC)':'Fin del servicio (UTC)',deadlineLabel=locale==='en'?'Download deadline (UTC)':'Fecha límite de descarga (UTC)';
  const ended=page.getByText(locale==='en'?'Downloads have ended.':'El plazo de descarga ha terminado.',{exact:true});
  const saveKey=page.getByRole('button',{name:locale==='en'?'Download recovery key':'Descargar clave de recuperación',exact:true});
  const saveManifest=page.getByRole('button',{name:locale==='en'?'Download backup manifest':'Descargar manifiesto de la copia',exact:true});
  const warning=page.getByText(locale==='en'?'You are now responsible for keeping your fiscal records. Download and check your copies.':'Ahora debes conservar tus registros fiscales. Descarga y comprueba tus copias.',{exact:true});
  assert.equal(await saveManifest.count(),0);
  let serviceEnded=false;
  let expired=false;
  const flag=async(route:import('playwright').Route)=>{
   const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),
    ...(serviceEnded?{exitRecovery:{effectiveEndAt,deadlineAt,expired}}:{}),...(expired?{}:{exitDownloadAvailable:true})}});
  };
  const checkDates=async()=>{
   for(const [label,instant] of [[endedLabel,effectiveEndAt],[deadlineLabel,deadlineAt]] as const){
    await page.getByText(label,{exact:true}).waitFor();
    assert.match(await page.locator(`time[datetime="${instant}"]`).innerText(),/\b12:00:00\b/);
   }
  };
  const captureWindow=async(state:string)=>{
   for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280]){
    await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:900});
    await choices.evaluate(element=>element.scrollIntoView({block:'start'}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:new URL(`../dist/backup-exit-${locale}-${colorScheme}-${width}-${state}.png`,import.meta.url).pathname,fullPage:true});
   }
   await page.emulateMedia({colorScheme:'light'});await page.setViewportSize(viewport);
  };
  await page.route('**/api/account/backups/list',flag);
  let proof=false;
  await page.route('**/api/account/action-proof',route=>route.fulfill({json:{methods:['app','recovery'],freshUntil:proof?new Date(Date.now()+60_000).toISOString():null}}));
  await page.route('**/api/account/action-proof/factor',route=>{
   assert.deepEqual(route.request().postDataJSON(),{kind:'recovery',code:'1'.repeat(32)});
   proof=true;return route.fulfill({status:204});
  });
  const archive=backupBytes({gzip:true}),key=recoveryKey+'\n';
  const manifest=backupManifest(archive);
  for(const [action,body,contentType] of [['download',archive,'application/octet-stream'],['download-key',key,'text/plain; charset=utf-8'],['download-manifest',manifest,'application/json']] as const){
   await page.route('**/api/account/backups/'+action,route=>{
    assert.equal(route.request().method(),'POST');assert.ok(route.request().headers()['x-csrf-token']);
    assert.deepEqual(route.request().postDataJSON(),{venueId:v.venueId,pointId:verifiedId});
    return route.fulfill({body,contentType,headers:{'content-length':String(Buffer.byteLength(body))}});
   });
  }
  await page.getByRole('button',{name:refresh,exact:true}).click();
  await saveManifest.waitFor();
  assert.equal(await warning.count(),0);
  serviceEnded=true;
  await page.getByRole('button',{name:refresh,exact:true}).click();
  await checkDates();assert.equal(await ended.count(),0);
  await choices.selectOption({index:0});
  assert.equal(await saveManifest.count(),0);
  await warning.waitFor();
  await choices.selectOption(verifiedId);
  await page.getByText(locale==='en'?'Later changes may be missing.':'Puede que falten cambios posteriores.',{exact:true}).waitFor();
  await captureWindow('open');
  assert.deepEqual(page.viewportSize(),viewport);
  await saveDatabase.click();
  const proofPrompt=page.getByRole('alert').filter({hasText:locale==='en'?'Verify it’s you before downloading.':'Verifica que eres tú antes de descargar.'});
  await proofPrompt.waitFor();
  await page.locator('wt-input[name=actionProofCode] input').fill('1'.repeat(32));
  await page.locator('.action-proof').getByRole('button',{name:c.factorRecovery,exact:true}).click();
  await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  assert.equal(await proofPrompt.count(),0);
  const [database]=await Promise.all([page.waitForEvent('download',{timeout:15000}),saveDatabase.click()]);
  assert.equal(database.suggestedFilename(),`waitron-backup-${verifiedId}.venue.db`);
  assert.deepEqual(await readFile((await database.path())!),venueDatabase);
  const stageIsPresent = async (expected:boolean) => {
   const root=await navigator.storage.getDirectory();
   try { await root.getDirectoryHandle('waitron-backup-download'); return expected; }
   catch(error){if(error instanceof DOMException&&error.name==='NotFoundError')return !expected;throw error;}
  };
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(stageIsPresent,true),true);
  for(const [button,contents,extension] of [[saveArchive,archive,'backup.enc'],[saveKey,key,'key'],[saveManifest,manifest,'manifest.json']] as const){
   const [download]=await Promise.all([page.waitForEvent('download',{timeout:5000}),button.click()]);
   assert.equal(download.suggestedFilename(),`waitron-backup-${verifiedId}.${extension}`);
   const file=await download.path();assert.ok(file);assert.deepEqual(await readFile(file),Buffer.from(contents));
  }
  if(locale==='en'){
   await page.evaluate(()=>{
    const getFile=FileSystemFileHandle.prototype.getFile;
    FileSystemFileHandle.prototype.getFile=async function(){
     if(this.name==='venue.db')await new Promise<void>(resolve=>{
      window.addEventListener('test-release-database',()=>resolve(),{once:true});
      document.documentElement.dataset.databasePaused='true';
     });
     return getFile.call(this);
    };
   });
   let extraDownloads=0;
   const countDownload=()=>{extraDownloads++;};
   page.on('download',countDownload);
   await saveDatabase.click();
   await page.waitForFunction(()=>document.documentElement.dataset.databasePaused==='true');
   const secondTab=await context.newPage();
   try{
    await secondTab.goto(f.origin+'/account');
    await secondTab.getByRole('button',{name:c.signout,exact:true}).waitFor();
    assert.equal(await secondTab.evaluate(stageIsPresent,true),true);
   }finally{await secondTab.close();}
   const replaceSession=(route:import('playwright').Route)=>route.fulfill({json:{accountId:randomUUID(),expiresAt:new Date(Date.now()+60_000).toISOString()}});
   await page.route('**/api/account/session',replaceSession);
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
   await saveDatabase.waitFor({state:'detached'});
   await page.evaluate(()=>window.dispatchEvent(new Event('test-release-database')));
   await page.waitForFunction(stageIsPresent,false);
   assert.equal(extraDownloads,0);
   page.off('download',countDownload);
   await page.unroute('**/api/account/session',replaceSession);
   await page.reload();
   await page.getByRole('button',{name:browse,exact:true}).click();
   await saveDatabase.waitFor();

   const piece = 4 * 1024 ** 2, attemptId = randomUUID();
   const largeDatabase = Buffer.concat([venueDatabase, Buffer.alloc(piece)]);
   const largeArchive = backupBytes({database:largeDatabase});
   const offsets:number[] = [];
   let expireOnSecondRead = true, releases = 0;
   await page.route('**/api/account/backups/download',route=>route.fulfill({status:413,json:{error:'download_too_large'}}));
   await page.route('**/api/account/backups/download-manifest',route=>route.fulfill({
    body:backupManifest(largeArchive),contentType:'application/json'}));
   await page.route('**/api/account/backups/download-range/start',route=>route.fulfill({json:{attemptId,size:largeArchive.length}}));
   await page.route('**/api/account/backups/download-range/read',route=>{
    const input=route.request().postDataJSON(),offset=Number(input.offset);
    assert.deepEqual(input,{venueId:v.venueId,pointId:verifiedId,attemptId,offset:String(offset)});
    offsets.push(offset);
    if(expireOnSecondRead&&offset===piece){
     expireOnSecondRead=false;proof=false;
     return route.fulfill({status:403,json:{error:'proof_required'}});
    }
    assert.equal(proof,true);
    const end=Math.min(largeArchive.length,offset+piece);
    return route.fulfill({status:206,contentType:'application/octet-stream',body:largeArchive.subarray(offset,end),
     headers:{'content-range':`bytes ${offset}-${end-1}/${largeArchive.length}`,'content-length':String(end-offset)}});
   });
   await page.route('**/api/account/backups/download-range/release',async route=>{
    if(releases++===0){
     assert.equal(await page.evaluate(async()=>{
      const root=await navigator.storage.getDirectory(), parent=await root.getDirectoryHandle('waitron-backup-download');
      for await(const folder of parent.values())if(folder.kind==='directory'){
       for await(const name of (folder as FileSystemDirectoryHandle).keys())if(name==='venue.db')return true;
      }
      return false;
     }),false);
     return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
    }
    return route.fulfill({status:204});
   });
   await Promise.all([page.waitForResponse(response=>response.url().endsWith('/download-range/read')&&response.status()===403),
    saveDatabase.click()]);
   await page.locator('#action-proof-heading').waitFor();
   assert.deepEqual(offsets,[0,piece]);
   await page.locator('wt-input[name=actionProofCode] input').fill('1'.repeat(32));
   const [resumed]=await Promise.all([page.waitForEvent('download',{timeout:15000}),
    page.locator('.action-proof').getByRole('button',{name:c.factorRecovery,exact:true}).click()]);
   assert.deepEqual(await readFile((await resumed.path())!),largeDatabase);
   const [encrypted]=await Promise.all([page.waitForEvent('download',{timeout:15000}),saveArchive.click()]);
   assert.deepEqual(await readFile((await encrypted.path())!),largeArchive);
   assert.deepEqual(offsets,[0,piece,piece,0,piece]);assert.equal(releases,3);
  }
  expired=true;
  await page.getByRole('button',{name:refresh,exact:true}).click();
  await ended.waitFor();await checkDates();
  assert.equal(await saveDatabase.count(),0);assert.equal(await saveArchive.count(),0);assert.equal(await saveKey.count(),0);
  assert.equal(await saveManifest.count(),0);
  assert.equal(await warning.count(),0);
  await captureWindow('ended');
  await page.unroute('**/api/account/backups/list',flag);
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false');await page.getByRole('button',{name:refresh,exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await choices.count(),0);
 }finally{await f.close();}
});
