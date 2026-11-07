import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body); new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const first = '12345678-1234-4234-8234-123456789abc';
const second = '22345678-1234-4234-8234-123456789abc';

async function open(browser: Browser, locale: 'en' | 'es', theme: 'light' | 'dark', width: number) {
  const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
  page.setDefaultTimeout(4000);
  let ids = [first, second];
  const writes: {path: string; body: unknown}[] = [];
  await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
    if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2030-01-01T00:00:00Z'}});
    if (path === '/passkeys') return route.fulfill({json: {passkeys: ids.map(id => ({id, createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null}))}});
    if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: true}});
    if (path === '/installations') return route.fulfill({json: {installations: []}});
    if (path === '/sessions') return route.fulfill({json: {sessions: [{id: '32345678-1234-4234-8234-123456789abc', createdAt: '2026-10-24T12:00:00Z', lastUsedAt: '2026-10-24T12:00:00Z', expiresAt: '2030-01-01T00:00:00Z', current: true}]}});
    const body: unknown = request.postDataJSON();
    if (request.method() === 'POST') writes.push({path, body});
    if (path === '/passkeys/remove' && (body as {id: string}).id === first) {
      ids = [second];
      return route.fulfill({status: 204});
    }
    return route.fulfill({status: 403, json: {error: 'credentials_invalid'}});
  });
  await page.goto('https://portal.test/account');
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: bundle.outputFiles[0]!.text});
  await page.locator('input[name=factorPassword]').waitFor();
  return {page, writes};
}

// Leaving the prior notice behind on a blank removal makes it reappear when typing clears the error.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: correcting a missing password does not repeat an earlier removal result`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const {page, writes} = await open(browser, locale, theme, width), c = translations[locale];
      const section = page.locator('.passkeys'), input = page.locator('input[name=passkeyPassword]');
      const remove = section.getByRole('button', {name: c.passkeyRemove, exact: true});
      await input.fill(' current password ');
      await remove.first().click();
      await section.getByRole('status').getByText(c.passkeyRemoved, {exact: true}).waitFor();
      assert.equal(await remove.count(), 1);
      assert.equal(await input.inputValue(), '');
      await remove.click();
      await section.getByRole('alert').getByText(c.requiredPassword, {exact: true}).waitFor();
      await input.pressSequentially('new password');
      await section.getByRole('alert').waitFor({state: 'detached'});
      assert.equal(await section.getByRole('status').count(), 0, 'an earlier result must not reappear for the remaining passkey');
      assert.equal(await input.getAttribute('aria-invalid'), 'false');
      assert.equal(await input.inputValue(), 'new password');
      assert.equal(await remove.count(), 1, 'the second passkey remains listed');
      assert.deepEqual(writes, [{path: '/passkeys/remove', body: {id: first, password: ' current password '}}], 'typing and the blank refusal send no removal');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PASSKEY_NOTICE_RECEIPT_DIR) {
        await mkdir(process.env.PASSKEY_NOTICE_RECEIPT_DIR, {recursive: true});
        await section.scrollIntoViewIfNeeded();
        await section.screenshot({path: `${process.env.PASSKEY_NOTICE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
    } finally { await browser.close(); }
  });
}

test('spaces remain password characters when correcting a required-input error', async t => {
  const browser = await chromium.launch({headless: true});
  try {
    for (const field of ['passkey', 'authenticator'] as const) await t.test(field, async () => {
      const {page, writes} = await open(browser, 'en', 'light', 390), c = translations.en;
      try {
        const section = page.locator(field === 'passkey' ? '.passkeys' : '.authenticator');
        const input = page.locator(`input[name=${field === 'passkey' ? 'passkeyPassword' : 'factorPassword'}]`);
        const submit = section.getByRole('button', {name: field === 'passkey' ? c.passkeyRemove : c.factorEnable, exact: true}).last();
        await submit.click();
        await section.getByRole('alert').getByText(c.requiredPassword, {exact: true}).waitFor();
        await input.fill(' ');
        await section.getByRole('alert').waitFor({state: 'detached'});
        assert.equal(await input.getAttribute('aria-invalid'), 'false');
        assert.deepEqual(writes, [], 'correcting input sends no security request');
        await submit.click();
        await section.getByRole('alert').waitFor();
        assert.deepEqual(writes, [{path: field === 'passkey' ? '/passkeys/remove' : '/authenticator/begin', body: field === 'passkey' ? {id: second, password: ' '} : {password: ' '}}]);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
