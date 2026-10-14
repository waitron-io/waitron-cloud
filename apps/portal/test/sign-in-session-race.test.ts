import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {hashSecret} from '@waitron-cloud/identity';
import {addVirtualAuthenticator, startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';

const password = 'A real session race account password';
const rule = {limit: 1000, windowSeconds: 60};
const factor = {keys: {activeKeyId: 'race', keys: {race: 'ac'.repeat(32)}}, policy: {
  loginLifetimeMs: 300_000, pendingLifetimeMs: 300_000, challengeAttempts: 10, enrolmentAttempts: 10,
  loginAccount: rule, completeIp: rule, completeAccount: rule, completeChallenge: rule, manageIp: rule, manageAccount: rule,
}};
function totp(secret: string) {
  const bits = [...secret].map(c => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('');
  const time = Buffer.alloc(8); time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac('sha1', Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)))).update(time).digest();
  return ((mac.readUInt32BE(mac[19]! & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return {promise, resolve};
}
for (const mode of ['password after removal', 'passkey after lost regeneration'] as const) {
  test(`a delayed ended-session read preserves ${mode}`, async () => {
    const f = await startPortalFixture(undefined, undefined, factor);
    const context = await f.browser.newContext(); const page = await context.newPage(); page.setDefaultTimeout(7000);
    const virtual = await addVirtualAuthenticator(context, page);
    const owner = {id: randomUUID(), email: `race-${randomUUID()}@example.test`}, c = translations.en;
    const sessionEntered = latch(), sessionRelease = latch(), loginEntered = latch(), loginRelease = latch();
    async function login() {
      await page.locator('input[name=email]').fill(owner.email); await page.locator('input[name=password]').fill(password);
      await page.getByRole('button', {name: c.login, exact: true}).click();
    }
    try {
      await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [owner.id]);
      await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())', [owner.id, owner.email, await hashSecret(password)]);
      await page.goto(`${f.origin}/login`); await login(); await page.getByText(c.accountIntro).waitFor();
      await page.locator('input[name=passkeyPassword]').fill(password); await page.getByRole('button', {name: c.passkeyAdd, exact: true}).click(); await page.getByText(c.passkeyAdded, {exact: true}).waitFor();
      await page.locator('input[name=factorPassword]').fill(password); await page.getByRole('button', {name: c.factorEnable, exact: true}).click();
      const secret = await page.locator('.factor-secret').textContent(); assert.ok(secret);
      await page.locator('input[name=factorPassword]').fill(password); await page.locator('input[name=factorConfirmation]').fill(totp(secret));
      await page.getByRole('button', {name: c.factorActivate, exact: true}).click(); await page.locator('.factor-codes').waitFor();
      const codes = await page.locator('.factor-codes code').allTextContents(); assert.equal(codes.length, 10);
      await page.getByRole('button', {name: c.factorCodesSaved, exact: true}).click(); await login(); await page.getByText(c.factorLoginHelp, {exact: true}).waitFor();
      await page.getByLabel(c.factorProofType).selectOption('recovery'); await page.locator('input[name=factorProof]').fill(codes[0]!);
      await page.getByRole('button', {name: c.factorVerify, exact: true}).click(); await page.getByText(c.accountIntro).waitFor(); await page.getByText(c.factorOn, {exact: true}).waitFor();
      const lost = mode === 'passkey after lost regeneration'; let reads = 0;
      await page.route('**/api/account/session', async route => {
        reads++;
        if (reads !== (lost ? 2 : 1)) { await route.continue(); return; }
        const response = await route.fetch(); assert.equal(response.status(), 401, 'the changed factor really ended the session');
        sessionEntered.resolve(); await sessionRelease.promise; await route.fulfill({response});
      });
      if (lost) f.loseAccountReply('/authenticator/regenerate');
      await page.locator('input[name=factorPassword]').fill(password); await page.getByLabel(c.factorProofType).selectOption('recovery'); await page.locator('input[name=factorProof]').fill(codes[1]!);
      await page.getByRole('button', {name: lost ? c.factorRegenerate : c.factorRemove, exact: true}).click();
      await page.getByText(lost ? c.factorChangeUncertain : c.factorRemoved, {exact: true}).waitFor(); await sessionEntered.promise;
      assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL', [owner.id])).rows[0].count, '0');
      const path = lost ? '/api/account/passkeys/authentication/options' : '/api/account/login';
      await page.route(`**${path}`, async route => {
        loginEntered.resolve(); await loginRelease.promise; await route.continue();
      });
      if (lost) await page.getByRole('button', {name: c.passkeySignIn, exact: true}).click(); else await login();
      await loginEntered.promise;
      const sessionDone = page.waitForResponse('**/api/account/session'); sessionRelease.resolve(); await (await sessionDone).finished();
      // Let the response's application callback run before releasing the new sign-in.
      await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      loginRelease.resolve();
      await page.getByText(c.accountIntro).waitFor();
      assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL', [owner.id])).rows[0].count, '1');
      assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_authenticator_factors WHERE account_id=$1 AND secret_envelope IS NOT NULL', [owner.id])).rows[0].count, lost ? '1' : '0');
    } finally {
      sessionRelease.resolve(); loginRelease.resolve(); await virtual.close(); await context.close(); await f.close();
    }
  });
}
