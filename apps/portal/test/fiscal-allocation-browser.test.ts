import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,sign,createPrivateKey} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import axe from 'axe-core';
import {SignupStore,RegistrationStore} from '@waitron-cloud/registration';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '../../../packages/registration/src/transaction.ts';
import {authorityFixture} from '../../../packages/fiscal-allocation/test/continuity-fixture.ts';
import {testOptions} from '../../../packages/fiscal-allocation/test/store-fixture.ts';
import {key,bases,scope,binding} from '../../../packages/fiscal-allocation/test/fixtures.ts';
import {paperSigningBytes,encodeReceipt,decodeReceipt} from '../../../packages/fiscal-allocation/src/evidence.ts';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: real phone reservation, uncertain consumption and retained paper evidence`,async()=>{
 const a=await authorityFixture(),paperKey=key(),options={...testOptions(a.adapter()),paperTrust:{custodianId:'custodian-1',custodyVersion:'custody-1',keys:new Map([[paperKey.keyId,paperKey.publicKey]])}};
 let f:Awaited<ReturnType<typeof startPortalFixture>>|undefined;
 try{
  f=await startPortalFixture(undefined,undefined,undefined,options);const db=f.db.pool;
  const signup=new SignupStore(db,f.db.outbox);await signup.request('fiscal@example.test');const mail=f.db.outbox.open((await db.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password:'A long synthetic owner password',organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  const registration=new RegistrationStore(db),request={operationId:randomUUID(),installationKey:key().publicKey,localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await registration.start(request);await registration.approveCloud(request,owner.accountId);await registration.approveLocal(request,randomUUID());const v=await registration.complete(request);
  await db.query('CREATE TABLE fiscal_test_authority(account_id uuid PRIMARY KEY,entitlement boolean NOT NULL DEFAULT true,custody boolean NOT NULL DEFAULT true,operator_verified boolean NOT NULL DEFAULT true,bases jsonb NOT NULL)');await db.query('INSERT INTO fiscal_test_authority(account_id,bases) VALUES($1,$2)',[owner.accountId,JSON.stringify(bases)]);
  const otherOrg=randomUUID(),otherBusiness=randomUUID();await db.query("INSERT INTO organisations(id,name) VALUES($1,'A second organisation')",[otherOrg]);await db.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,true)',[owner.accountId,otherOrg]);await db.query("INSERT INTO legal_businesses(id,organisation_id,name) VALUES($1,$2,'Another venue')",[otherBusiness,otherOrg]);
  const otherRequest={...request,operationId:randomUUID(),localVenueId:randomUUID(),installationKey:key().publicKey,organisationId:otherOrg,legalBusinessId:otherBusiness};await registration.start(otherRequest);await registration.approveCloud(otherRequest,owner.accountId);await registration.approveLocal(otherRequest,randomUUID());await registration.complete(otherRequest);
  const session=await transaction(db,c=>createSession(c,owner.accountId));
  const context=await f.browser.newContext({locale,colorScheme:theme,viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(6000);const c=translations[locale];page.on('pageerror',e=>console.error('FISCAL_BROWSER_ERROR',e.message));
  await context.addCookies([{name:'cloud_session',value:session.token,url:f.origin,httpOnly:true},{name:'cloud_csrf',value:session.csrfToken,url:f.origin}]);
  const reserveBodies:string[]=[];page.on('request',r=>{if(r.url().endsWith('/api/account/fiscal-allocations/reserve'))reserveBodies.push(r.postData()!);});
  const responses:{path:string;status:number}[]=[];page.on('response',r=>{if(r.url().includes('/fiscal-allocations'))responses.push({path:new URL(r.url()).pathname,status:r.status()});});
  let aborted=false;await page.route('**/api/account/session',async route=>{if(!aborted){aborted=true;await route.abort();}else await route.continue();});
  await page.goto(f.origin+'/fiscal-allocations');await page.getByRole('button',{name:c.retry,exact:true}).click();await page.getByRole('heading',{name:c.fiscalTitle,exact:true}).waitFor();
  await page.getByLabel(c.recoveryOrganisation,{exact:true}).selectOption(owner.organisationId);
  await page.getByLabel(c.fiscalVenue,{exact:true}).selectOption(v.venueId);
  await page.locator('wt-input[name=fiscalNif] input').fill(scope.taxpayerNif);await page.locator('wt-input[name=fiscalSoftware] input').fill(scope.softwareId);
  for(const field of ['eventId','operatorId','sourceId','targetNodeId','incidentEvidence'] as const)await page.locator(`wt-input[name=${field}] input`).fill(binding[field]);
  await page.locator('wt-input[name=base-0] input').fill('A');await page.getByRole('button',{name:c.fiscalAddBase,exact:true}).click();await page.locator('wt-input[name=base-1] input').fill('FF');await page.getByLabel(c.fiscalPurpose+' 2',{exact:true}).selectOption('full');await page.getByRole('button',{name:c.fiscalAddBase,exact:true}).click();await page.locator('wt-input[name=base-2] input').fill('R');await page.getByLabel(c.fiscalPurpose+' 3',{exact:true}).selectOption('rectificative');
  const check=async(state:string)=>{
   await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[],state);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state+' overflow');
   assert.equal(await page.evaluate(()=>innerWidth),width);
   if(process.env.FISCAL_PORTAL_RECEIPT_DIR){await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:process.env.FISCAL_PORTAL_RECEIPT_DIR+`/${locale}-${theme}-${width}-${state}.png`,fullPage:true});}
  };
  await check('ready');
  let reserveBlocked=true;await page.route('**/api/account/fiscal-allocations/reserve',async route=>{if(reserveBlocked){reserveBlocked=false;await route.abort();}else await route.continue();});
  f.loseAccountReply('/fiscal-allocations/reserve','body');await page.getByRole('button',{name:c.fiscalReserve,exact:true}).click();await page.getByRole('alert').filter({hasText:c.fiscalUncertain}).waitFor({timeout:20000});await check('uncertain');
  await page.getByRole('button',{name:c.fiscalReconcile,exact:true}).click();await page.getByRole('button',{name:c.fiscalRetry,exact:true}).waitFor();await check('unknown');await page.getByRole('button',{name:c.fiscalRetry,exact:true}).click();await page.getByRole('alert').filter({hasText:c.fiscalUncertain}).waitFor({timeout:20000});
  await page.getByRole('button',{name:c.fiscalReconcile,exact:true}).click();assert.equal(reserveBodies.length,2);assert.equal(reserveBodies[1],reserveBodies[0]);await page.getByText(c.fiscalReserved,{exact:true}).waitFor();
  assert.equal((await db.query('SELECT count(*)::int AS n FROM fiscal_registry_allocations')).rows[0].n,1);
  for(const label of [c.fiscalStandard,c.fiscalFull,c.fiscalRectificative])assert(await page.getByText(label,{exact:true}).count()>0);
  const consume=page.getByRole('button',{name:c.fiscalConsume,exact:true});assert(await consume.isDisabled());
  await page.getByLabel(c.fiscalOffline,{exact:true}).check();assert(await consume.isDisabled());await page.getByLabel(c.fiscalNoParallel,{exact:true}).check();
  f.loseAccountReply('/fiscal-allocations/consume','body');await consume.click();await page.getByRole('alert').filter({hasText:c.fiscalUncertain}).waitFor({timeout:20000});assert.equal(await page.getByRole('button',{name:c.fiscalDownload,exact:true}).count(),0);
  await page.getByRole('button',{name:c.fiscalReconcile,exact:true}).click();await page.getByText(c.fiscalConsumed,{exact:true}).waitFor();await page.getByText(c.fiscalLocalChecks,{exact:true}).waitFor();
  const packet=await page.getByLabel(c.fiscalPacket,{exact:true}).inputValue();const stored=(await db.query("SELECT result FROM fiscal_registry_events WHERE action='consume'")).rows[0].result;assert.equal(packet,encodeReceipt(stored));decodeReceipt(packet,options.trust!);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:c.fiscalDownload,exact:true}).click();const download=await downloadPromise;const {readFile}=await import('node:fs/promises');assert.equal(await readFile((await download.path())!,'utf8'),packet);
  await db.query('UPDATE fiscal_test_authority SET entitlement=false');await page.getByRole('button',{name:c.fiscalHistoryRefresh,exact:true}).click();await page.getByRole('button',{name:c.fiscalInspect,exact:true}).first().click();assert.equal(await page.getByLabel(c.fiscalPacket,{exact:true}).inputValue(),packet);await check('retained');
  await page.getByRole('button',{name:c.fiscalNew,exact:true}).click();await page.getByRole('button',{name:c.fiscalReserve,exact:true}).click();await page.getByRole('alert').filter({hasText:c.fiscalEntitlement}).waitFor();await check('error');
  await db.query('UPDATE fiscal_test_authority SET entitlement=true');
  const paperAllocation={version:1 as const,allocationId:randomUUID(),...scope,installationIdentity:'P000042',series:bases.map(b=>({code:b.code+'-P000042',purpose:b.purpose})),source:'paper' as const,issuedAt:new Date().toISOString()};
  const block={version:1 as const,custodianId:'custodian-1',generationId:'generation-1',blockId:'block-1',packVersion:1 as const,recipientVenueId:v.venueId,allocations:[paperAllocation]};
  const history={version:1,operationId:randomUUID(),venueId:v.venueId,scope,custodyVersion:'custody-1',registerRevision:'1',previousDigest:'0'.repeat(64),block:{payload:block,signature:sign(null,paperSigningBytes(block),createPrivateKey({key:Buffer.from(paperKey.privateKey,'base64url'),format:'der',type:'pkcs8'})).toString('base64url')},consumptions:[],transfers:[]};
  const input=page.getByLabel(c.fiscalPaper,{exact:true});await input.fill(JSON.stringify(history));await page.getByRole('button',{name:c.fiscalImport,exact:true}).click();await page.getByText(c.fiscalImported,{exact:true}).waitFor();
  for(const bad of [{...history,operationId:randomUUID(),registerRevision:'0'},{...history,operationId:randomUUID(),block:{...history.block,signature:Buffer.alloc(64,2).toString('base64url')}}]){await input.fill(JSON.stringify(bad));await page.getByRole('button',{name:c.fiscalImport,exact:true}).click();await page.getByRole('alert').waitFor();}
  assert.equal((await db.query('SELECT count(*)::int AS n FROM fiscal_registry_allocations')).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int AS n FROM backup_locations')).rows[0].n,0);
  assert(!(await page.content()).includes(paperKey.privateKey));
  if(process.env.FISCAL_PORTAL_RECEIPT_DIR)await writeFile(process.env.FISCAL_PORTAL_RECEIPT_DIR+`/${locale}-${theme}-${width}.json`,JSON.stringify({responses,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,background:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.body).color})),packet,receipt:stored},null,2));
 }finally{await f?.close();await a.close();}
});
