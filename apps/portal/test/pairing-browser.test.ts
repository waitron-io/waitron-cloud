import {prepareConnectionProof} from '../../../packages/registration/test/fixtures/action-proof.ts';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {PairingStore,SignupStore} from '@waitron-cloud/registration';
import {startPortalFixture,completeBrowserEmail} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} connection requires code, Cloud approval and a separate local completion`,async()=>{
  const f=await startPortalFixture();
  try{
    const email=`pair-${randomUUID()}@example.test`,password='A real café owner password';
    const signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);
    const row=(await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0];const payload=f.db.outbox.open(row);assert.ok('token' in payload);
    const owner=await signup.complete(payload.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
    const requestId=randomUUID(),code='12345678',venueName='Café <strong>Sol</strong>';
    await new PairingStore(f.db.pool).start({origin:f.origin,action:'start',requestId,publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',code,organisationId:'',legalBusinessId:'',issuedAt:Date.now(),venueName});
    const initialColorScheme=locale==='es'?'dark':'light';
    const context=await f.browser.newContext({locale,viewport:{width:375,height:812},colorScheme:initialColorScheme});const page=await context.newPage();page.setDefaultTimeout(5000);const c=translations[locale];
    const venueDetails=page.locator('.pairing-details');
    const venueLabel=locale==='es'?'Nombre del local':'Venue name';
    async function checkVenue(phase:string){
      const nameLabel=venueDetails.getByText(venueLabel,{exact:true});
      await nameLabel.waitFor();
      assert.equal(await nameLabel.locator('+ dd').textContent(),venueName);
      assert.equal(await venueDetails.locator('.venue-id').textContent(),c.pairNewVenue);
      for(const width of [390,1280])for(const colorScheme of ['light','dark'] as const){
        await page.setViewportSize({width,height:812});
        await page.emulateMedia({colorScheme});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:new URL(`../dist/pairing-${phase}-${locale}-${colorScheme}-${width}.png`,import.meta.url).pathname,fullPage:true});
      }
      await page.setViewportSize({width:375,height:812});
      await page.emulateMedia({colorScheme:initialColorScheme});
    }
    const urls:string[]=[];page.on('request',r=>urls.push(r.url()));
    await page.goto(`${f.origin}/connect#request=${requestId}`);await page.getByRole('heading',{name:c.login,exact:true}).waitFor();
    assert.ok(!page.url().includes(requestId));
    await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await completeBrowserEmail(f,page,email,locale);
    await page.getByRole('heading',{name:c.connect,exact:true}).waitFor();
    await page.getByRole('textbox',{name:c.pairCode,exact:true}).fill('00000000');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();await page.getByText(c.pairUnavailable).waitFor();
    assert.equal((await f.db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
    await page.getByRole('textbox',{name:c.pairCode,exact:true}).fill(code);
    await page.getByLabel(c.language,{exact:true}).selectOption(locale==='en'?'es':'en');
    assert.equal(await page.locator('input[name=pairingCode]').inputValue(),code);
    await page.getByLabel(translations[locale==='en'?'es':'en'].language,{exact:true}).selectOption(locale);
    await page.getByRole('button',{name:c.pairInspect,exact:true}).click();await checkVenue('inspect');
    assert.equal((await f.db.pool.query('SELECT cloud_account_id FROM pairing_requests')).rows[0].cloud_account_id,null);
    assert.ok(await page.getByText('Sol SL',{exact:true}).isVisible());
    await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=> (await window.axe.run(document)).violations),[]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const token=(await context.cookies()).find(cookie=>cookie.name==='cloud_session')!.value;
    await prepareConnectionProof(f.db.pool,owner.accountId,token);
    let approvals=0;await page.route('**/pairing/approve',async route=>{approvals++;const reply=await route.fetch();if(approvals===1)await route.abort('failed');else await route.fulfill({response:reply});});
    await page.getByRole('button',{name:c.pairApprove,exact:true}).click();await page.getByText(c.pairUncertain).waitFor();
    await page.getByRole('button',{name:c.pairApprove,exact:true}).click();await page.getByText(c.pairApproved).waitFor();
    await checkVenue('approved');
    const approved=(await f.db.pool.query('SELECT * FROM pairing_requests')).rows[0];
    assert.equal(approved.cloud_account_id,owner.accountId);assert.equal(approved.result,null);
    assert.equal((await f.db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
    assert.ok(urls.every(url=>!url.includes(requestId)&&!url.includes(code)));
    await page.getByRole('button',{name:c.signout,exact:true}).click();await page.getByText(c.signedOut).waitFor();
    let businessLoads=0;await page.route('**/pairing/businesses',route=>++businessLoads===1?route.fulfill({status:503,json:{error:'unavailable'}}):route.continue());
    await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await completeBrowserEmail(f,page,email,locale);
    await page.getByText(c.unavailable,{exact:true}).waitFor();assert.equal(await page.getByText(c.sessionUnavailable,{exact:true}).count(),0);
    await page.getByRole('button',{name:c.retry,exact:true}).click();
    await page.getByRole('textbox',{name:c.pairCode,exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:c.pairCode,exact:true}).inputValue(),'');
    await page.route('**/pairing/inspect',route=>route.fulfill({status:429,headers:{'retry-after':'60'},json:{error:'rate_limited'}}));
    await page.getByRole('textbox',{name:c.pairCode,exact:true}).fill(code);await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
    await page.getByText(c.limited,{exact:false}).waitFor();
    await page.getByRole('button',{name:c.signout,exact:true}).click();await page.getByText(c.signedOut).waitFor();
    await page.reload();await page.getByRole('heading',{name:c.login,exact:true}).waitFor();
    await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await completeBrowserEmail(f,page,email,locale);
    await page.getByRole('button',{name:c.signout,exact:true}).waitFor();
    await page.goto(`${f.origin}/connect`);await page.getByText(c.pairMissing).waitFor();
  }finally{await f.close();}
});

test('a linked code checks the venue once after sign-in and leaves approval to the owner', async () => {
  const f = await startPortalFixture();
  try {
    const email = `pair-link-${randomUUID()}@example.test`, password = 'A real café owner password';
    const signup = new SignupStore(f.db.pool, f.db.outbox);
    await signup.request(email);
    const row = (await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0];
    const payload = f.db.outbox.open(row);
    assert.ok('token' in payload);
    await signup.complete(payload.token, {password, organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES'});
    const requestId = randomUUID(), code = '01234567', venueName = 'Café Luna';
    await new PairingStore(f.db.pool).start({origin: f.origin, action: 'start', requestId,
      publicKey: generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64url'),
      venueId: '', environment: 'test', code, organisationId: '', legalBusinessId: '', issuedAt: Date.now(), venueName});
    const page = await f.browser.newPage({locale: 'en'});
    page.setDefaultTimeout(5000);
    const c = translations.en;
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(`${f.origin}/connect#request=${requestId}&code=${code}`);
    await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(requests.filter(url => url.endsWith('/pairing/inspect')).length, 0);
    await page.getByLabel(c.email).fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', {name: c.login, exact: true}).click();
    await completeBrowserEmail(f, page, email, 'en');
    await page.getByRole('button', {name: c.pairApprove, exact: true}).waitFor();
    assert.equal(await page.locator('.pairing-details').getByText(venueName, {exact: true}).isVisible(), true);
    assert.equal(requests.filter(url => url.endsWith('/pairing/inspect')).length, 1);
    assert.equal(requests.filter(url => url.endsWith('/pairing/approve')).length, 0);
    assert.equal((await f.db.pool.query('SELECT cloud_account_id FROM pairing_requests WHERE id=$1', [requestId])).rows[0].cloud_account_id, null);
    assert.ok(requests.every(url => !url.includes(requestId) && !url.includes(code)));
  } finally { await f.close(); }
});
