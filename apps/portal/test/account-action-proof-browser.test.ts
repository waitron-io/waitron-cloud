import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {test} from 'node:test';
import {hashSecret,createSession,encryptFactorSecret} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import axe from 'axe-core';
import {openProofWindow} from '../../../packages/registration/test/fixtures/action-proof.ts';
import {startPortalFixture,completeBrowserEmail,addVirtualAuthenticator,mailFor} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])test(`shared action proof ${locale} ${colorScheme} ${width}`,async()=>{
 const keys={activeKeyId:'test',keys:{test:'07'.repeat(32)}},rule={limit:1000,windowSeconds:60};
 const f=await startPortalFixture(undefined,undefined,{keys,policy:{loginLifetimeMs:300000,pendingLifetimeMs:300000,challengeAttempts:10,enrolmentAttempts:10,loginAccount:rule,completeIp:rule,completeAccount:rule,completeChallenge:rule,manageIp:rule,manageAccount:rule}});
 const context=await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}}),page=await context.newPage(),virtual=await addVirtualAuthenticator(context,page),c=translations[locale];
 const id=randomUUID(),email=`proof-${id}@example.test`,password='Synthetic action proof password';page.setDefaultTimeout(7000);
 try{
  await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[id,email,await hashSecret(password)]);
  await page.goto(f.origin+`/login#lang=${locale}`);await page.locator('input[name=email]').fill(email);await page.locator('input[name=password]').fill(password);await page.locator('#submit').click();await completeBrowserEmail(f,page,email,locale);await page.getByText(c.accountIntro).waitFor();
  await page.getByRole('heading',{name:c.actionProofTitle}).waitFor();
  assert.equal(await page.locator('input[name=passkeyPassword],input[name=factorPassword]').count(),0);
  await page.locator('.action-proof').screenshot({path:`/tmp/d608-prompt-${locale}-${colorScheme}-${width}.png`});
  await page.getByRole('button',{name:c.actionProofEmail,exact:true}).click();await page.locator('input[name=actionProofCode]').waitFor();await page.locator('.action-proof').screenshot({path:`/tmp/d608-code-${locale}-${colorScheme}-${width}.png`});await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run('.action-proof')).violations),[]);
  const queued=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='sign_in_check' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.equal(queued.locale,locale,'security proof email follows the selected language');
  await f.drainMail();const message=await mailFor(email,locale==='en'?'Your Waitron Cloud verification code':'Tu código de verificación de Waitron Cloud');const code=message.match(/^([0-9]{6})$/m)?.[1];assert.ok(code);await page.locator('input[name=actionProofCode]').fill(code);await page.locator('input[name=actionProofCode]').press('Enter');await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  await page.locator('.action-proof').screenshot({path:`/tmp/d608-ready-${locale}-${colorScheme}-${width}.png`});
  await page.screenshot({path:`/tmp/d608-proof-${locale}-${colorScheme}-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:c.factorEnable,exact:true}).focus();await page.keyboard.press('Enter');await page.locator('.factor-secret').waitFor();await page.locator('.authenticator').screenshot({path:`/tmp/d608-setup-${locale}-${colorScheme}-${width}.png`});await page.getByRole('button',{name:c.factorCancel,exact:true}).click();await page.locator('.factor-secret').waitFor({state:'hidden'});
  await page.getByRole('button',{name:c.passkeyAdd,exact:true}).focus();await page.keyboard.press('Enter');await page.getByText(c.passkeyAdded,{exact:true}).waitFor();
  assert.equal((await f.db.pool.query('SELECT action_proved_at IS NOT NULL AS fresh FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[id])).rows[0].fresh,true,'adding a key preserves this session window');
  await f.db.pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '11 minutes' WHERE account_id=$1",[id]);await page.reload();await page.getByRole('button',{name:c.actionProofPasskey,exact:true}).waitFor();
  await page.locator('.action-proof').screenshot({path:`/tmp/d608-passkey-${locale}-${colorScheme}-${width}.png`});
  await page.route('**/api/account/action-proof/passkey/verify',route=>route.fulfill({status:403,json:{error:'proof_required'}}));
  await page.getByRole('button',{name:c.actionProofPasskey,exact:true}).click();await page.locator('.action-proof [role=alert]').waitFor();
  assert.equal(await page.locator('.passkeys [role=alert]').count(),0,'proof refusal belongs to its shared prompt');
  await page.unroute('**/api/account/action-proof/passkey/verify');
  await page.getByRole('button',{name:c.actionProofPasskey,exact:true}).click();await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  await page.getByRole('button',{name:c.factorRegenerate,exact:true}).click();await page.locator('.factor-codes').waitFor();assert.equal(await page.locator('.factor-codes code').count(),10);await page.locator('.factor-codes').screenshot({path:`/tmp/d608-codes-${locale}-${colorScheme}-${width}.png`});
  const saved=await page.locator('.factor-codes code').allTextContents(),secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',generation=randomUUID();
  await f.db.pool.query(`INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,$3)
   ON CONFLICT(account_id) DO UPDATE SET version=1,secret_generation=excluded.secret_generation,secret_envelope=excluded.secret_envelope`,[id,generation,encryptFactorSecret(secret,keys,{accountId:id,version:1,purpose:'active'})]);
  const actor=await transaction(f.db.pool,client=>createSession(client,id));
  await context.addCookies([{name:'cloud_session',value:actor.token,url:f.origin,httpOnly:true},{name:'cloud_csrf',value:actor.csrfToken,url:f.origin}]);
  await page.goto(f.origin+`/account#lang=${locale}`);await page.locator('input[name=actionProofCode]').waitFor();
  await page.locator('.action-proof').screenshot({path:`/tmp/d608-app-${locale}-${colorScheme}-${width}.png`});
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',Buffer.from('12345678901234567890')).update(counter).digest();
  const appCode=((mac.readUInt32BE(mac[19]!&15)&0x7fffffff)%1000000).toString().padStart(6,'0');
  await page.locator('input[name=actionProofCode]').fill(appCode);await page.getByRole('button',{name:c.factorTotp,exact:true}).click();await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  await f.db.pool.query("UPDATE cloud_sessions SET action_proved_at=clock_timestamp()-interval '11 minutes' WHERE account_id=$1",[id]);
  await page.reload();await page.locator('input[name=actionProofCode]').fill(saved[0]!);await page.getByRole('button',{name:c.factorRecovery,exact:true}).click();await page.getByText(c.actionProofReady,{exact:true}).waitFor();
  assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[id])).rows[0].count,'1');

 }finally{await virtual.close();await context.close();await f.close();}
});

test('email verification continues the Add request once', async () => {
  const f = await startPortalFixture();
  const context = await f.browser.newContext({locale: 'en'});
  const page = await context.newPage(), virtual = await addVirtualAuthenticator(context, page);
  const id = randomUUID(), email = `add-${id}@example.test`;
  page.setDefaultTimeout(7000);
  try {
    await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [id]);
    await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',
      [id, email, await hashSecret('Synthetic password for Add')]);
    const actor = await transaction(f.db.pool, client => createSession(client, id));
    await context.addCookies([{name: 'cloud_session', value: actor.token, url: f.origin}, {name: 'cloud_csrf', value: actor.csrfToken, url: f.origin}]);
    await page.goto(f.origin + '/account');
    await page.getByRole('button', {name: 'Add a passkey', exact: true}).click();
    await page.getByText('Verify it’s you to add a passkey.', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'action-proof-heading');
    await page.getByRole('button', {name: 'Email a code', exact: true}).click();
    const input = page.locator('input[name=actionProofCode]');
    await input.waitFor();
    await f.drainMail();
    const code = (await mailFor(email, 'Your Waitron Cloud verification code')).match(/^([0-9]{6})$/m)?.[1];
    assert.ok(code);
    await input.fill(code);
    await input.press('Enter');
    await page.getByText('Your passkey was added.', {exact: true}).waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'passkey-feedback');
    assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_passkeys WHERE account_id=$1', [id])).rows[0].count, '1');
  } finally { await virtual.close(); await context.close(); await f.close(); }
});

for (const scenario of ['lost reply', 'refused', 'navigation', 'standalone', 'retry'] as const) {
  test(`Add continuation after passkey verification: ${scenario}`, async () => {
    const f = await startPortalFixture();
    const context = await f.browser.newContext({locale: 'en'});
    const page = await context.newPage(), virtual = await addVirtualAuthenticator(context, page);
    let replacement: Awaited<ReturnType<typeof addVirtualAuthenticator>> | undefined;
    const id = randomUUID();
    const verifyPath = '/action-proof/passkey/verify';
    page.setDefaultTimeout(7000);
    try {
      await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [id]);
      await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',
        [id, `passkey-${id}@example.test`, await hashSecret('Synthetic password for proof')]);
      const actor = await transaction(f.db.pool, client => createSession(client, id));
      await context.addCookies([{name: 'cloud_session', value: actor.token, url: f.origin}, {name: 'cloud_csrf', value: actor.csrfToken, url: f.origin}]);
      const expire = () => f.db.pool.query('UPDATE cloud_sessions SET action_proved_at=NULL WHERE account_id=$1', [id]);
      const fresh = () => openProofWindow(f.db.pool, actor.token);
      const added = page.getByText('Your passkey was added.', {exact: true});
      const add = page.getByRole('button', {name: 'Add a passkey', exact: true});
      await fresh();
      await page.goto(f.origin + '/account');
      await add.click();
      await added.waitFor();
      await expire();
      await page.reload();
      if (scenario !== 'standalone') await add.click();
      let enrollments = 0;
      const trace: string[] = [];
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (path.includes('/action-proof') || path.includes('/passkeys/registration')) trace.push(`${response.status()} ${path}`);
      });
      page.on('requestfailed', request => {
        const path = new URL(request.url()).pathname;
        if (path.includes('/action-proof') || path.includes('/passkeys/registration')) trace.push(`${request.failure()?.errorText} ${path}`);
      });
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/account/passkeys/registration/options') enrollments++;
      });
      if (scenario === 'lost reply') {
        await page.route(`**/api/account${verifyPath}`, async route => {
          const response = await route.fetch();
          assert.equal(response.status(), 204);
          await route.abort('connectionreset');
        });
        await page.route('**/api/account/passkeys/registration/options', async route => {
          await virtual.close();
          replacement = await addVirtualAuthenticator(context, page);
          await route.continue();
        });
      }
      if (scenario === 'refused') await page.route(`**/api/account${verifyPath}`, async route => {
        await fresh();
        await route.fulfill({status: 403, json: {error: 'proof_required'}});
      });
      if (scenario === 'navigation') await page.route(`**/api/account${verifyPath}`, async route => {
        const response = await route.fetch();
        await page.evaluate(() => { void history.pushState(null, '', '/account'); dispatchEvent(new PopStateEvent('popstate')); });
        await route.fulfill({response});
      });
      if (scenario === 'retry') await page.route('**/api/account/passkeys/registration/options', async route => {
        const response = await route.fetch();
        await virtual.close();
        await page.evaluate(() => {
          navigator.credentials.create = async () => { throw new DOMException('No authenticator', 'NotAllowedError'); };
        });
        await route.fulfill({response});
      });
      await page.getByRole('button', {name: 'Use a passkey', exact: true}).click();
      if (scenario === 'lost reply') {
        await added.waitFor().catch(async error => {
          console.error('Passkey continuation', {
            trace, proof: await page.locator('.action-proof').innerText(), passkeys: await page.locator('.passkeys').innerText(),
          });
          throw error;
        });
        assert.equal(enrollments, 1);
      } else if (scenario === 'retry') {
        await page.getByText('Select Add a passkey again to finish.', {exact: true}).waitFor();
        await page.waitForFunction(() => document.activeElement?.id === 'passkey-add');
        assert.equal(enrollments, 1);
      } else {
        await page.getByText('Identity verified.', {exact: true}).waitFor();
        const proofAlert = page.locator('.action-proof [role=alert]');
        if (scenario === 'refused') await proofAlert.or(page.locator('.passkeys [role=alert]')).first().waitFor();
        await add.waitFor();
        assert.equal(enrollments, 0);
        if (scenario === 'refused') await proofAlert.waitFor();
      }
      const saved = await f.db.pool.query('SELECT count(*) FROM cloud_passkeys WHERE account_id=$1', [id]);
      assert.equal(saved.rows[0].count, scenario === 'lost reply' ? '2' : '1');
    } finally { await replacement?.close(); await virtual.close(); await context.close(); await f.close(); }
  });
}
