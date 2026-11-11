import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {hashSecret} from '@waitron-cloud/identity';
import {completeBrowserEmail,contextSignIn,addVirtualAuthenticator, startPortalFixture, mailFor} from './fixtures.ts';
import {translations} from '../src/locale.ts';

const password = 'A real passkey account password';
const rule={limit:1000,windowSeconds:60};
const policy={loginLifetimeMs:300000,pendingLifetimeMs:300000,challengeAttempts:5,enrolmentAttempts:5,
  loginAccount:rule,completeIp:rule,completeAccount:rule,completeChallenge:rule,manageIp:rule,manageAccount:rule};

test('real resident passkeys enrol, authenticate once, stay account-scoped, and can be removed', async () => {
  const f = await startPortalFixture(undefined,undefined,{keys:null,policy});
  try {
    for (const [locale, colorScheme, viewport] of [
      ['en', 'light', {width: 1280, height: 900}],
      ['es', 'dark', {width: 390, height: 812}],
    ] as const) {
      const owner = {id: randomUUID(), email: `passkey-${locale}-${randomUUID()}@example.test`};
      const other = {id: randomUUID(), email: `other-${locale}-${randomUUID()}@example.test`};
      for (const account of [owner, other]) {
        await f.db.pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [account.id]);
        await f.db.pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
          [account.id, account.email, await hashSecret(password)]);
      }
      const context = await f.browser.newContext({locale, colorScheme, viewport});
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      const authenticator = await addVirtualAuthenticator(context, page);
      const errors: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text());
      });
      page.on('pageerror', error => errors.push(error.message));
      const options: unknown[] = [];
      let authenticationCompletion: {url: string; body: unknown} | undefined;
      await page.route('**/api/account/passkeys/**', async route => {
        const request = route.request();
        if (request.url().endsWith('/options')) {
          const response = await route.fetch();
          options.push(await response.json());
          await route.fulfill({response});
          return;
        }
        if (request.url().endsWith('/authentication/verify')) authenticationCompletion = {url: request.url(), body: request.postDataJSON()};
        await route.continue();
      });
      const c = translations[locale];
      try {
        await page.goto(`${f.origin}/login#lang=${locale}`);
        await page.getByLabel(c.email).fill(owner.email);
        await page.locator('input[name=password]').fill(password);
        await page.getByRole('button', {name: c.login, exact: true}).click();
        await completeBrowserEmail(f,page,owner.email,locale);
        await page.getByText(c.accountIntro).waitFor();
        await page.locator('input[name=passkeyPassword]').fill(password);
        const registrationReply = page.waitForResponse('**/passkeys/registration/verify').then(response => ({response}));
        await page.getByRole('button', {name: c.passkeyAdd, exact: true}).click();
        const registrationResult = await Promise.race([registrationReply,
          page.getByRole('alert').filter({hasText: c.passkeyUnavailable}).first().waitFor().then(() => ({response: undefined}))]);
        assert.ok(registrationResult.response,
          JSON.stringify({page: await page.locator('body').innerText(), errors, options}, null, 2));
        const registrationResponse = registrationResult.response;
        assert.equal(registrationResponse.status(), 201, await registrationResponse.text());
        await page.getByText(c.passkeyAdded, {exact: true}).waitFor();
        assert.equal((options.at(-1) as {options: {rp: {id: string}}}).options.rp.id, new URL(f.origin).hostname);
        assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_passkeys WHERE account_id = $1', [owner.id])).rows[0].count, '1');

        await page.getByRole('button', {name: c.signout, exact: true}).click();
        await page.getByText(c.signedOut, {exact: true}).waitFor();
        await page.getByRole('button', {name: c.passkeySignIn, exact: true}).click();
        await page.getByText(c.accountIntro).waitFor();
        assert.equal((options.at(-1) as {options: {rpId: string}}).options.rpId, new URL(f.origin).hostname);
        assert.ok(authenticationCompletion);
        const replay = await context.request.post(authenticationCompletion.url, {headers: {origin: f.origin}, data: authenticationCompletion.body});
        assert.equal(replay.status(), 401);
        assert.deepEqual(await replay.json(), {error: 'credentials_invalid'});

        const created = (await f.db.pool.query('SELECT id FROM cloud_passkeys WHERE account_id = $1', [owner.id])).rows[0].id as string;
        const otherContext = await f.browser.newContext({locale});
        try {
          const login = await contextSignIn(f,otherContext,other.email,password,locale);
          assert.equal(login.status(), 200);
          assert.deepEqual(await (await otherContext.request.get(`${f.origin}/api/account/passkeys`)).json(), {passkeys: []});
          const csrf = (await otherContext.cookies()).find(cookie => cookie.name === 'cloud_csrf')?.value; assert.ok(csrf);
          const removal = await otherContext.request.post(`${f.origin}/api/account/passkeys/remove`,
            {headers: {origin: f.origin, 'x-csrf-token': csrf}, data: {id: created, password}});
          assert.equal(removal.status(), 204);
          assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_passkeys WHERE id = $1', [created])).rows[0].count, '1');
        } finally { await otherContext.close(); }

        const unsupportedContext = await f.browser.newContext({locale});
        await unsupportedContext.addInitScript(() => {
          Object.defineProperty(globalThis, 'PublicKeyCredential', {value: undefined, configurable: true});
        });
        try {
          const login = await unsupportedContext.request.post(`${f.origin}/api/account/login`,
            {headers: {origin: f.origin}, data: {email: owner.email, password,locale}});
          assert.equal(login.status(),202);
          assert.equal((await unsupportedContext.cookies()).some(cookie=>cookie.name==='cloud_session'),false);
          const challenge=await login.json() as {emailRequired:boolean;challengeToken:string};assert.equal(challenge.emailRequired,true);
          await f.drainMail();const mail=await mailFor(owner.email,locale==='en'?'Your Waitron Cloud sign-in code':'Tu código de acceso a Waitron Cloud',f.mailEvidence);
          const code=mail.match(/^([0-9]{6})$/m)?.[1];assert.ok(code);
          assert.equal((await unsupportedContext.request.post(`${f.origin}/api/account/login/email`,{headers:{origin:f.origin},data:{challengeToken:challenge.challengeToken,code}})).status(),200);
          const unsupportedPage = await unsupportedContext.newPage(); unsupportedPage.setDefaultTimeout(5000);
          await unsupportedPage.goto(`${f.origin}/account#lang=${locale}`);
          await unsupportedPage.getByText(c.passkeyUnsupported, {exact: true}).waitFor();
          await unsupportedPage.locator('input[name=passkeyPassword]').waitFor();
          await unsupportedPage.getByRole('button', {name: c.passkeyRemove, exact: true}).waitFor();
        } finally { await unsupportedContext.close(); }

        await page.locator('input[name=passkeyPassword]').fill(password);
        await page.getByRole('button', {name: c.passkeyRemove, exact: true}).click();
        await page.getByText(c.passkeyRemoved, {exact: true}).waitFor();
        assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_passkeys WHERE account_id = $1', [owner.id])).rows[0].count, '0');
        await page.getByRole('button', {name: c.signout, exact: true}).click();
        await page.getByText(c.signedOut, {exact: true}).waitFor();
        await page.getByLabel(c.email).fill(owner.email);
        await page.locator('input[name=password]').fill(password);
        await page.getByRole('button', {name: c.login, exact: true}).click();
        await page.getByText(c.accountIntro).waitFor();
        assert.deepEqual(errors, []);
      } finally {
        await authenticator.close();
        await context.close();
      }
    }
  } finally { await f.close(); }
});
