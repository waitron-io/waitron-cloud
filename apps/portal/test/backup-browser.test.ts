import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} owner browses snapshot history at phone width`,async()=>{
 const f=await startPortalFixture();try{
  const email='backups@example.test',password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const v=await r.complete(b);
  const context=await f.browser.newContext({locale,viewport:{width:375,height:812}}),page=await context.newPage();page.setDefaultTimeout(4000);const c=translations[locale];
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  const browse=locale==='en'?'View snapshots':'Ver instantáneas',refresh=locale==='en'?'Latest snapshots':'Últimas instantáneas',older=locale==='en'?'Older snapshots':'Instantáneas anteriores',choose=locale==='en'?'Choose a snapshot':'Elige una instantánea';
  await page.getByRole('button',{name:browse,exact:true}).click();await page.getByText(locale==='en'?'No snapshots have been stored for this venue.':'No se han guardado instantáneas de este local.',{exact:true}).waitFor();
  await f.db.pool.query("INSERT INTO backup_locations(venue_id,installation_id,endpoint,bucket,region) VALUES($1,$2,'https://store.test','catalogue-browser','local')",[v.venueId,v.installationId]);await f.db.pool.query("INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,1,'unusable-fixture')",[v.venueId]);
  let verifiedId='';
  for(let n=0;n<52;n++){
   const id=randomUUID();if(n===1)verifiedId=id;await f.db.pool.query('INSERT INTO backup_captures(id,venue_id,installation_id,key_version) VALUES($1,$2,$3,1)',[id,v.venueId,v.installationId]);
   await f.db.pool.query("INSERT INTO backup_points(id,venue_id,installation_id,key_version,kind,object_key,digest,size,captured_at,retention,source_node_id,modules,verification) VALUES($1,$2,$3,1,'snapshot',$4,$5,100,clock_timestamp()-($6::text||' days')::interval,'daily',$7,'{}',$8)",[id,v.venueId,v.installationId,'snapshots/'+id,'a'.repeat(64),n,randomUUID(),n===1?'verified':'pending']);
  }
  await page.getByRole('button',{name:refresh,exact:true}).click();const choices=page.getByLabel(choose,{exact:true});await choices.waitFor();assert.equal(await choices.locator('option').count(),50);assert.equal(await choices.inputValue(),verifiedId);
  await page.getByText(locale==='en'?'Verified':'Verificada',{exact:true}).waitFor();await choices.selectOption({index:0});await page.getByText(locale==='en'?'Awaiting verification':'Pendiente de verificación',{exact:true}).waitFor();
  await page.getByText(locale==='en'?'To restore a snapshot, open the Cloud recovery link from the replacement server’s setup screen.':'Para restaurar una instantánea, abre el enlace de recuperación de Cloud desde la configuración del servidor de sustitución.',{exact:true}).waitFor();
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);await page.screenshot({path:new URL(`../dist/backups-${locale}.png`,import.meta.url).pathname,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,width:e.getBoundingClientRect().width})))));
  await page.getByRole('button',{name:older,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#snapshot-choice option').length===2);assert.equal(await page.getByRole('button',{name:older,exact:true}).count(),0);
  await page.getByRole('button',{name:refresh,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#snapshot-choice option').length===50);
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false');await page.getByRole('button',{name:refresh,exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await choices.count(),0);
 }finally{await f.close();}
});
