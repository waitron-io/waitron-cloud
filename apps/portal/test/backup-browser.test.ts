import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import axe from 'axe-core';
import {admitPointFixture} from '../../../packages/backups/test/fixtures/verification.ts';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {completeBrowserEmail,startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} owner browses snapshot history at phone width`,async()=>{
 const f=await startPortalFixture();try{
  const email='backups@example.test',password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const v=await r.complete(b);
  const viewport={width:375,height:812};
  const context=await f.browser.newContext({locale,timezoneId:'Europe/Madrid',viewport}),page=await context.newPage();page.setDefaultTimeout(4000);const c=translations[locale];
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
  const saveArchive=page.getByRole('button',{name:locale==='en'?'Download backup':'Descargar copia',exact:true});
  assert.equal(await saveArchive.count(),0);
  const effectiveEndAt='2026-01-01T12:00:00.000Z',deadlineAt='2026-04-01T12:00:00.000Z';
  const endedLabel=locale==='en'?'Service ended (UTC)':'Fin del servicio (UTC)',deadlineLabel=locale==='en'?'Download deadline (UTC)':'Fecha límite de descarga (UTC)';
  const ended=page.getByText(locale==='en'?'Downloads have ended.':'El plazo de descarga ha terminado.',{exact:true});
  const saveKey=page.getByRole('button',{name:locale==='en'?'Download recovery key':'Descargar clave de recuperación',exact:true});
  let expired=false;
  const flag=async(route:import('playwright').Route)=>{
   const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),
    exitRecovery:{effectiveEndAt,deadlineAt,expired},...(expired?{}:{exitDownloadAvailable:true})}});
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
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:new URL(`../dist/backup-exit-${locale}-${colorScheme}-${width}-${state}.png`,import.meta.url).pathname,fullPage:true});
   }
   await page.emulateMedia({colorScheme:null});await page.setViewportSize(viewport);
  };
  await page.route('**/api/account/backups/list',flag);
  let proof=false;
  await page.route('**/api/account/action-proof',route=>route.fulfill({json:{methods:['app','recovery'],freshUntil:proof?new Date(Date.now()+60_000).toISOString():null}}));
  await page.route('**/api/account/action-proof/factor',route=>{
   assert.deepEqual(route.request().postDataJSON(),{kind:'recovery',code:'1'.repeat(32)});
   proof=true;return route.fulfill({status:204});
  });
  const archive='synthetic encrypted archive',key='k'.repeat(43)+'\n';
  for(const [action,body,contentType] of [['download',archive,'application/octet-stream'],['download-key',key,'text/plain; charset=utf-8']] as const){
   await page.route('**/api/account/backups/'+action,route=>{
    assert.equal(route.request().method(),'POST');assert.ok(route.request().headers()['x-csrf-token']);
    assert.deepEqual(route.request().postDataJSON(),{venueId:v.venueId,pointId:verifiedId});
    return route.fulfill({body,contentType});
   });
  }
  await page.getByRole('button',{name:refresh,exact:true}).click();
  await choices.selectOption(verifiedId);
  await checkDates();assert.equal(await ended.count(),0);
  await captureWindow('open');
  assert.deepEqual(page.viewportSize(),viewport);
  await saveArchive.click();
  const proofPrompt=page.getByRole('alert').filter({hasText:locale==='en'?'Verify it’s you before downloading.':'Verifica que eres tú antes de descargar.'});
  await proofPrompt.waitFor();
  await page.locator('wt-input[name=actionProofCode] input').fill('1'.repeat(32));
  await page.locator('.action-proof').getByRole('button',{name:c.factorRecovery,exact:true}).click();
  await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  assert.equal(await proofPrompt.count(),0);
  for(const [button,contents,extension] of [[saveArchive,archive,'backup.enc'],[saveKey,key,'key']] as const){
   const [download]=await Promise.all([page.waitForEvent('download',{timeout:5000}),button.click()]);
   assert.equal(download.suggestedFilename(),`waitron-backup-${verifiedId}.${extension}`);
   const file=await download.path();assert.ok(file);assert.equal(await readFile(file,'utf8'),contents);
  }
  expired=true;
  await page.getByRole('button',{name:refresh,exact:true}).click();
  await ended.waitFor();await checkDates();
  assert.equal(await saveArchive.count(),0);assert.equal(await saveKey.count(),0);
  await captureWindow('ended');
  await page.unroute('**/api/account/backups/list',flag);
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false');await page.getByRole('button',{name:refresh,exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await choices.count(),0);
 }finally{await f.close();}
});
