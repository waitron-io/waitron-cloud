import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body); new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const password = ' current password ', token = 'A'.repeat(43);
const id = '12345678-1234-4234-8234-123456789abc';

// Removing one field's clearing, clearing another field, or hiding server refusals must fail these journeys.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: typing into a refused field clears its message`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      for (const flow of ['passkey', 'password', 'proof', 'confirmation'] as const) await t.test(flow, async () => {
        const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
        page.setDefaultTimeout(4000);
        const c = translations[locale], active = flow === 'proof' || flow === 'confirmation';
        const writes: {path: string; body: unknown}[] = [];
        let status = 403;
        try {
          await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
          await page.route('**/api/account/**', route => {
            const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
            if (endpoint === '/session' || endpoint === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2030-01-01T00:00:00Z'}});
            if (endpoint === '/passkeys') return route.fulfill({json: {passkeys: [{id, createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null}]}});
            if (endpoint === '/authenticator') return route.fulfill({json: {active, version: active ? 1 : 0, recoveryCodesRemaining: active ? 10 : 0, available: true}});
            if (endpoint === '/installations') return route.fulfill({json: {installations: []}});
            if (request.method() === 'POST') writes.push({path: endpoint, body: request.postDataJSON()});
            if (flow === 'confirmation' && endpoint === '/authenticator/begin') return route.fulfill({json: {pendingToken: token, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP', expiresAt: '2030-01-01T00:00:00Z'}});
            return route.fulfill({status, json: {error: status === 403 ? 'credentials_invalid' : 'temporarily_unavailable'}});
          });
          await page.goto('https://portal.test/account');
          await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
          await page.locator('input[name=factorPassword]').waitFor();
          const section = page.locator(flow === 'passkey' ? '.passkeys' : '.authenticator');
          const fieldName = flow === 'passkey' ? 'passkeyPassword' : flow === 'password' ? 'factorPassword' : flow === 'proof' ? 'factorProof' : 'factorConfirmation';
          if (flow === 'confirmation') {
            await page.locator('input[name=factorPassword]').fill(password);
            await page.locator('input[name=factorProof]').fill('123 456');
            await section.getByRole('button', {name: c.factorReplace, exact: true}).click();
            await page.locator('input[name=factorConfirmation]').waitFor();
            await page.locator('input[name=factorProof]').fill('123 456');
          }
          if (flow === 'proof' || flow === 'confirmation') await page.locator('input[name=factorPassword]').fill(password);
          const field = page.locator(`wt-input[name=${fieldName}]`), input = field.locator('input');
          const submit = section.getByRole('button', {name: flow === 'passkey' ? c.passkeyRemove : flow === 'password' ? c.factorEnable : flow === 'proof' ? c.factorRemove : c.factorActivate, exact: true});
          const message = flow === 'passkey' || flow === 'password' ? c.requiredPassword : c.factorCodeRequired;
          const value = flow === 'passkey' || flow === 'password' ? password : '123 456';
          const alert = section.getByRole('alert');
          async function settled() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
          writes.length = 0;
          await submit.click(); await alert.getByText(message, {exact: true}).waitFor();
          assert.deepEqual(writes, [], 'blank input is refused before any security write');
          assert.equal(await input.getAttribute('aria-invalid'), 'true');
          assert.equal(await field.getByText(message, {exact: true}).count(), 1);

          const otherName = flow === 'passkey' ? 'factorPassword' : flow === 'password' ? 'passkeyPassword' : flow === 'confirmation' ? 'factorProof' : 'factorPassword';
          await page.locator(`input[name=${otherName}]`).fill(password + 'other'); await settled();
          assert.equal(await alert.getByText(message, {exact: true}).count(), 1, 'editing another field keeps the refusal');
          await input.fill(flow === 'proof' || flow === 'confirmation' ? ' \t ' : '');
          await input.dispatchEvent('input'); await settled();
          assert.equal(await input.getAttribute('aria-invalid'), 'true', 'an empty field still needs input');
          assert.equal(await alert.getByText(message, {exact: true}).count(), 1);

          await input.fill(value); await settled();
          assert.equal(await field.getByText(message, {exact: true}).count(), 0, 'the resolved field message clears before submitting');
          assert.equal(await input.getAttribute('aria-invalid'), 'false');
          assert.equal(await alert.count(), 0, 'the resolved summary clears before submitting');
          assert.deepEqual(writes, [], 'typing never sends a security request');
          assert.equal(await input.inputValue(), value);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (process.env.ACCOUNT_REQUIRED_RECEIPT_DIR) {
            await mkdir(process.env.ACCOUNT_REQUIRED_RECEIPT_DIR, {recursive: true});
            await field.scrollIntoViewIfNeeded();
            await page.screenshot({path: `${process.env.ACCOUNT_REQUIRED_RECEIPT_DIR}/${locale}-${theme}-${width}-${flow}.png`});
          }
          const alternate = locale === 'en' ? 'es' : 'en';
          await page.getByRole('combobox', {name: c.language, exact: true}).selectOption(alternate); await settled();
          assert.equal(await input.inputValue(), value, 'language changes keep the typed input');
          await page.getByRole('combobox', {name: translations[alternate].language, exact: true}).selectOption(locale); await settled();
          assert.equal(await input.inputValue(), value);
          if (flow === 'proof' || flow === 'confirmation') await page.locator('input[name=factorPassword]').fill(password);
          if (flow === 'confirmation') await page.locator('input[name=factorProof]').fill('123 456');
          if (flow === 'proof' || flow === 'confirmation') {
            await input.fill('12345'); await submit.click();
            const malformed = flow === 'proof' ? c.factorCodeInvalid : c.factorConfirmationInvalid;
            await alert.getByText(malformed, {exact: true}).waitFor();
            await input.fill(value); await settled();
            assert.equal(await alert.getByText(malformed, {exact: true}).count(), 0, 'editing clears the previous local format refusal');
            assert.equal(await input.getAttribute('aria-invalid'), 'false');
            assert.deepEqual(writes, [], 'malformed input is still refused locally');
          }
          const endpoint = flow === 'passkey' ? '/passkeys/remove' : flow === 'password' ? '/authenticator/begin' : flow === 'proof' ? '/authenticator/remove' : '/authenticator/activate';
          const body = flow === 'passkey' ? {id, password} : flow === 'password' ? {password} : flow === 'proof' ? {password, proof: {kind: 'totp', code: '123456'}} : {password, proof: {kind: 'totp', code: '123456'}, pendingToken: token, code: '123456'};
          for (status of [403, flow === 'proof' || flow === 'confirmation' ? 400 : 503]) {
            if (flow === 'proof' || flow === 'confirmation') await page.locator('input[name=factorPassword]').fill(password);
            if (flow === 'confirmation') await page.locator('input[name=factorProof]').fill('123 456');
            await input.fill(value); await submit.click();
            const refusal = status === 403 ? (flow === 'passkey' ? c.passkeyPasswordInvalid : c.credentials) : status === 400 ? c.factorUnavailable : (flow === 'passkey' ? c.passkeyChangeUncertain : c.factorChangeUncertain);
            await alert.getByText(refusal, {exact: true}).waitFor();
            assert.deepEqual(writes.at(-1), {path: endpoint, body});
            await input.fill(value + '7'); await settled();
            assert.equal(await alert.getByText(refusal, {exact: true}).count(), 1, 'typing keeps server refusals and uncertain results');
          }
          assert.equal(writes.length, 2, 'only the two explicit submissions send security writes');
        } finally { await page.close(); }
      });
    } finally { await browser.close(); }
  });
}
