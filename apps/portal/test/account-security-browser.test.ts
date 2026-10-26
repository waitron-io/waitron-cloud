import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {Request} from 'playwright';
import {hashSecret} from '@waitron-cloud/identity';
import {addVirtualAuthenticator, startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';

const password = 'A real account security password';

test('account security is clear in both languages at phone and desktop widths', async () => {
  const f = await startPortalFixture();
  try {
    for (const [locale, colorScheme, viewport, label] of [
      ['en', 'light', {width: 1280, height: 900}, 'desktop-light'],
      ['en', 'dark', {width: 390, height: 812}, 'phone-dark'],
      ['es', 'light', {width: 390, height: 812}, 'phone-light'],
      ['es', 'dark', {width: 1280, height: 900}, 'desktop-dark'],
    ] as const) {
      const account = {id: randomUUID(), email: `security-${locale}-${label}-${randomUUID()}@example.test`};
      await f.db.pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [account.id]);
      await f.db.pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
        [account.id, account.email, await hashSecret(password)]);
      await f.db.pool.query('INSERT INTO cloud_passkey_users (account_id, user_handle) VALUES ($1, $2)', [account.id, randomBytes(32)]);
      await f.db.pool.query(`INSERT INTO cloud_passkeys
        (id, account_id, credential_id, public_key, counter, transports, device_type, backed_up, created_at, last_used_at)
        VALUES ($1, $2, $3, $4, 1, $5, 'multiDevice', true, clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour')`,
      [randomUUID(), account.id, randomBytes(32).toString('base64url'), randomBytes(64), ['internal']]);
      const context = await f.browser.newContext({locale, colorScheme, viewport});
      const other = await f.browser.newContext({locale});
      try {
        for (const target of [context, other]) {
          const login = await target.request.post(`${f.origin}/api/account/login`,
            {headers: {origin: f.origin}, data: {email: account.email, password}});
          assert.equal(login.status(), 200);
        }
        const page = await context.newPage(); page.setDefaultTimeout(5000);
        const c = translations[locale];
        await page.goto(`${f.origin}/account#lang=${locale}`);
        await page.getByRole('heading', {name: c.accountSecurity, exact: true}).waitFor();
        await page.locator('.session-list li').first().waitFor();
        assert.equal(await page.locator('.session-list li').count(), 2);
        await page.getByText(c.currentSession, {exact: true}).waitFor();
        await page.getByText(c.otherSession, {exact: true}).waitFor();
        await page.getByText(c.sessionLastUsed, {exact: true}).first().waitFor();
        await page.locator('.passkey-list li').waitFor();
        assert.equal(await page.locator('.passkey-list li').count(), 1);
        await page.locator('.passkey-list').getByText(c.passkeyLastUsed, {exact: true}).waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({path: new URL(`../dist/account-security-${locale}-${label}.png`, import.meta.url).pathname, fullPage: true});
      } finally {
        await context.close();
        await other.close();
      }
    }
  } finally { await f.close(); }
});

test('lost session-revoke replies reconcile the list and current-session state', async () => {
  const f = await startPortalFixture();
  try {
    const account = {id: randomUUID(), email: `security-reconcile-${randomUUID()}@example.test`};
    await f.db.pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [account.id]);
    await f.db.pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
      [account.id, account.email, await hashSecret(password)]);
    const context = await f.browser.newContext({locale: 'en'});
    const other = await f.browser.newContext({locale: 'en'});
    try {
      for (const target of [context, other]) {
        const login = await target.request.post(`${f.origin}/api/account/login`,
          {headers: {origin: f.origin}, data: {email: account.email, password}});
        assert.equal(login.status(), 200);
      }
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      const c = translations.en;
      await page.goto(`${f.origin}/account`);
      await page.getByText(c.otherSession, {exact: true}).waitFor();
      f.loseAccountReply('/sessions/revoke');
      await page.locator('.session-list li').filter({hasText: c.otherSession}).getByRole('button', {name: c.sessionRevoke}).click();
      await page.getByText(c.sessionRevoked, {exact: true}).waitFor();
      assert.equal(await page.locator('.session-list li').count(), 1);
      assert.equal((await other.request.get(`${f.origin}/api/account/session`)).status(), 401);

      f.loseAccountReply('/sessions/revoke');
      await page.getByRole('button', {name: c.sessionSignOut, exact: true}).click();
      await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
    } finally {
      await context.close();
      await other.close();
    }
  } finally { await f.close(); }
});

test('sign out remains available while a passkey prompt is open', async t => {
  const f = await startPortalFixture();
  try {
    const account = {id: randomUUID(), email: `security-pending-${randomUUID()}@example.test`};
    await f.db.pool.query('INSERT INTO cloud_accounts (id) VALUES ($1)', [account.id]);
    await f.db.pool.query('INSERT INTO cloud_credentials (account_id, email, password_hash) VALUES ($1, $2, $3)',
      [account.id, account.email, await hashSecret(password)]);
    const context = await f.browser.newContext({locale: 'en'});
    await context.addInitScript(() => {
      Object.defineProperty(navigator.credentials, 'create', {configurable: true, value: () => {
        (window as unknown as {accountSecurityPromptOpen: boolean}).accountSecurityPromptOpen = true;
        return new Promise(() => {});
      }});
    });
    try {
      const login = await context.request.post(`${f.origin}/api/account/login`,
        {headers: {origin: f.origin}, data: {email: account.email, password}});
      assert.equal(login.status(), 200);
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      const pending = new Map<Request, string>(), trace: {path: string; phase: string; ms: number}[] = [];
      const started = performance.now();
      const paths = new Set(['/api/account/session', '/api/account/session/activity', '/api/account/authenticator',
        '/api/account/sessions', '/api/account/installations', '/api/account/usage/read', '/api/account/passkeys',
        '/api/account/passkeys/registration/options']);
      const record = (request: Request, phase: string) => {
        const path = new URL(request.url()).pathname;
        if (!paths.has(path)) return;
        if (phase === 'request') pending.set(request, path); else pending.delete(request);
        trace.push({path, phase, ms: Math.round(performance.now() - started)});
        if (trace.length > 32) trace.shift();
      };
      page.on('request', request => record(request, 'request'));
      page.on('requestfinished', request => record(request, 'finished'));
      page.on('requestfailed', request => record(request, 'failed'));
      const authenticator = await addVirtualAuthenticator(context, page);
      const c = translations.en;
      try {
        await page.goto(`${f.origin}/account`);
        const signOut = page.getByRole('button', {name: c.signout, exact: true});
        // Startup work has its own sign-out guards; isolate the browser prompt after it settles.
        await signOut.and(page.locator(':enabled')).waitFor();
        await page.locator('input[name=passkeyPassword]').fill(password);
        const options = page.waitForResponse('**/passkeys/registration/options');
        await page.getByRole('button', {name: c.passkeyAdd, exact: true}).click();
        assert.equal((await options).status(), 200);
        await page.waitForFunction(() => (window as unknown as {accountSecurityPromptOpen: boolean}).accountSecurityPromptOpen);
        const revokeCurrent = page.getByRole('button', {name: c.sessionSignOut, exact: true});
        t.diagnostic(JSON.stringify({pending: [...pending.values()], trace}));
        assert.equal(await revokeCurrent.isDisabled(), false);
        assert.equal(await signOut.isDisabled(), false);
        await signOut.click();
        await page.getByRole('heading', {name: c.login, exact: true}).waitFor();
      } catch (error) {
        t.diagnostic(JSON.stringify({pending: [...pending.values()], trace}));
        throw error;
      } finally { await authenticator.close(); }
    } finally { await context.close(); }
  } finally { await f.close(); }
});
