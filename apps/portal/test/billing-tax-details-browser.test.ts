import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {mkdir} from 'node:fs/promises';
import axe from 'axe-core';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';

const cases=(['en','es'] as const).flatMap(locale=>(['light','dark'] as const).flatMap(theme=>[390,1280].map(width=>({locale,theme,width,accountId:randomUUID(),organisationId:randomUUID(),businessId:randomUUID(),venueId:randomUUID()}))));
for(const item of cases)test(item.locale+' '+item.theme+' '+item.width+': tax form saves reloads and corrects through the real account API',async()=>{
 const {locale,theme,width,accountId,businessId}=item,c=translations[locale];
 const fixture=await startPortalFixture(undefined,undefined,undefined,undefined,false,undefined,undefined,{accountIds:[accountId]});
 let context:Awaited<ReturnType<typeof fixture.browser.newContext>>|undefined;
 try{
  const session=await transaction(fixture.db.pool,async client=>{
   await client.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
   await client.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[accountId,'tax-'+accountId+'@example.test']);
   await client.query('INSERT INTO organisations(id) VALUES($1)',[item.organisationId]);
   await client.query("INSERT INTO legal_businesses(id,organisation_id,country_code) VALUES($1,$2,'ES')",[businessId,item.organisationId]);
   await client.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[accountId,item.organisationId]);
   await client.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[item.venueId,item.organisationId,businessId]);
   return createSession(client,accountId);
  });
  context=await fixture.browser.newContext({locale,colorScheme:theme,viewport:{width,height:1000}});
  await context.addCookies([{name:'cloud_session',value:session.token,url:fixture.origin,httpOnly:true},{name:'cloud_csrf',value:session.csrfToken,url:fixture.origin}]);
  const page=await context.newPage();page.setDefaultTimeout(5000);
  await page.goto(fixture.origin+'/account/billing');
  const form=page.getByRole('form',{name:c.billingTaxTitle,exact:true}),name=form.getByRole('textbox',{name:c.billingTaxName,exact:true}),address=form.getByRole('textbox',{name:c.billingTaxAddress,exact:true}),number=form.getByRole('textbox',{name:c.billingTaxNumber,exact:true});
  await form.waitFor().catch(async error=>{console.error(JSON.stringify({case:{locale,theme,width},trace:fixture.trace.slice(-20),body:await page.locator('body').innerText()}));throw error;});assert.equal(await name.getAttribute('aria-invalid'),'false');
  await form.getByRole('button',{name:c.billingTaxSave,exact:true}).click();
  assert.equal(await name.getAttribute('aria-invalid'),'true');
  assert.equal(await name.evaluate(element=>element.getRootNode() instanceof ShadowRoot&&(element.getRootNode() as ShadowRoot).activeElement===element),true);
  assert.equal((await fixture.db.pool.query('SELECT name FROM legal_businesses WHERE id=$1',[businessId])).rows[0].name,null);
  await name.fill('Synthetic café');await address.fill('Synthetic street 1');await number.fill('TEST-123');
  await form.getByRole('button',{name:c.billingTaxSave,exact:true}).focus();await page.keyboard.press('Enter');
  await form.getByRole('status').filter({hasText:c.billingTaxSaved}).waitFor();
  assert.deepEqual((await fixture.db.pool.query('SELECT name,billing_address,tax_number,country_code FROM legal_businesses WHERE id=$1',[businessId])).rows,[{name:'Synthetic café',billing_address:'Synthetic street 1',tax_number:'TEST-123',country_code:'ES'}]);
  await page.reload();await form.waitFor();assert.equal(await name.inputValue(),'Synthetic café');assert.equal(await address.inputValue(),'Synthetic street 1');assert.equal(await number.inputValue(),'TEST-123');
  await number.fill('TEST-456');await number.press('Enter');
  await form.getByRole('status').filter({hasText:c.billingTaxSaved}).waitFor();
  assert.equal((await fixture.db.pool.query('SELECT tax_number FROM legal_businesses WHERE id=$1',[businessId])).rows[0].tax_number,'TEST-456');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(axe.source);assert.deepEqual((await page.evaluate(async()=>(await (window as any).axe.run(document)).violations)).map((value:any)=>({id:value.id,nodes:value.nodes.map((node:any)=>node.target)})),[]);
  await form.evaluate(element=>element.scrollIntoView({block:'center'}));
  if(process.env.BILLING_TAX_RECEIPT_DIR){await mkdir(process.env.BILLING_TAX_RECEIPT_DIR,{recursive:true});await form.screenshot({path:process.env.BILLING_TAX_RECEIPT_DIR+'/'+locale+'-'+theme+'-'+width+'.png'});}
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));assert.equal(await form.count(),0);
 }finally{await context?.close();await fixture.close();}
});
