import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import {translations, type Locale} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const token = 'A'.repeat(43), expiresAt = '2099-01-01T00:00:00.000Z', password = 'current password';
type Flow = 'login'|'remove'|'activate';
let browser: Browser;
before(async () => {browser = await chromium.launch({headless: true});});
after(async () => {await browser?.close();});

async function open(flow: Flow, locale: Locale, theme: 'light'|'dark', width: number, status = 400) {
 const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
 page.setDefaultTimeout(4000);
 const c = translations[locale], login = flow === 'login', path = login ? '/login' : '/account';
 const writes: {path: string; body: unknown}[] = [], errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.route('https://portal.test'+path, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
 await page.route('**/api/account/**', route => {
  const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
  if (endpoint === '/session' || endpoint === '/session/activity') return login ? route.fulfill({status: 401, json: {error: 'credentials_invalid'}}) : route.fulfill({json: {accountId: 'owner', expiresAt}});
  if (endpoint === '/authenticator') return route.fulfill({json: {active: flow !== 'activate', version: flow === 'activate' ? 0 : 1, recoveryCodesRemaining: flow === 'activate' ? 0 : 10, available: true}});
  if (request.method() === 'POST') writes.push({path: endpoint, body: request.postDataJSON()});
  if (endpoint === '/login') return route.fulfill({status: 202, json: {factorRequired: true, challengeToken: token, expiresAt}});
  if (endpoint === '/authenticator/begin' && flow === 'activate') return route.fulfill({json: {pendingToken: token, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Cloud?secret=JBSWY3DPEHPK3PXP', expiresAt}});
  if (endpoint === '/login/factor' || endpoint.startsWith('/authenticator/')) return status === 0 ? route.abort('connectionreset') : route.fulfill({status, headers: status === 429 ? {'Retry-After': '60'} : {}, json: {error: status === 400 ? 'invalid_input' : status === 429 ? 'rate_limited' : status === 403 ? 'credentials_invalid' : 'temporarily_unavailable'}});
  return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
 });
 await page.goto('https://portal.test'+path);
 await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
 if (login) {
  await page.locator('input[name=email]').fill('owner@example.test'); await page.locator('input[name=password]').fill(password);
  await page.getByRole('button', {name: c.login, exact: true}).click(); await page.locator('input[name=factorProof]').waitFor();
 } else {
  await page.locator('input[name=factorPassword]').waitFor();
  if (flow === 'activate') {
   await page.locator('input[name=factorPassword]').fill(password); await page.getByRole('button', {name: c.factorEnable, exact: true}).click();
   await page.locator('input[name=factorConfirmation]').waitFor();
  }
 }
 writes.length = 0;
 const field = page.locator(`wt-input[name=${flow === 'activate' ? 'factorConfirmation' : 'factorProof'}]`), input = field.locator('input');
 const submit = page.getByRole('button', {name: login ? c.factorVerify : flow === 'remove' ? c.factorRemove : c.factorActivate, exact: true});
 const feedback = login ? page.locator('wt-form-error-summary') : page.locator('.authenticator > p[role=alert]');
 const message = flow === 'activate' ? c.factorConfirmationInvalid : c.factorCodeInvalid;
 async function enter(code: string) {if (!login) await page.locator('input[name=factorPassword]').fill(password); await input.fill(code);}
 return {page, c, field, input, submit, feedback, message, writes, errors, enter};
}

// Omitting either code field's format clearing leaves both its marker and old summary visible.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
 for (const flow of ['login', 'remove', 'activate'] as const) test(`${locale} ${theme} ${width}: ${flow} code edits clear only local format feedback`, async () => {
  const {page, c, field, input, submit, feedback, message, writes, errors, enter} = await open(flow, locale, theme, width);
  try {
   const kinds = flow === 'activate' ? ['totp'] as const : ['totp', 'recovery'] as const;
   for (const kind of kinds) {
    if (flow !== 'activate') await page.getByRole('combobox', {name: c.factorProofType, exact: true}).selectOption(kind);
    await enter('12345'); await submit.click(); await feedback.getByText(message, {exact: true}).waitFor();
    assert.equal(await input.getAttribute('aria-invalid'), 'true'); assert.deepEqual(writes, []);
    if (flow !== 'login') {
     await page.locator('input[name=factorPassword]').fill('changed password');
     assert.equal(await input.getAttribute('aria-invalid'), 'true', 'editing another field keeps this code error');
     assert.equal(await feedback.getByText(message, {exact: true}).count(), 1);
    }
    await input.fill('7');
    assert.equal(await input.getAttribute('aria-invalid'), 'false', 'editing clears the previous code-format marker');
    assert.equal(await field.getByText(message, {exact: true}).count(), 0);
    assert.equal(await feedback.getByText(message, {exact: true}).count(), 0);
    assert.deepEqual(writes, [], 'editing must not submit a proof or change settings');
    await submit.click(); await feedback.getByText(message, {exact: true}).waitFor();
    assert.equal(await input.getAttribute('aria-invalid'), 'true', 'submit validates the edited code again');
    await input.fill('');
    assert.equal(await input.getAttribute('aria-invalid'), 'false', 'deleting the value also clears old format feedback');
    await submit.click(); await feedback.getByText(c.factorCodeRequired, {exact: true}).waitFor();
    await input.fill(' ');
    assert.equal(await input.getAttribute('aria-invalid'), 'true', 'whitespace still leaves required-code feedback');
    await input.fill('12345');
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
    await submit.click(); await feedback.getByText(message, {exact: true}).waitFor();
    await input.fill(kind === 'recovery' ? 'ABCDEF01-23456789-ABCDEF01-23456789' : '123 456');
    assert.equal(await input.getAttribute('aria-invalid'), 'false'); assert.deepEqual(writes, []);
   }
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   assert.deepEqual(errors, []);
   if (process.env.AUTHENTICATOR_EDIT_RECEIPT_DIR) {
    await mkdir(process.env.AUTHENTICATOR_EDIT_RECEIPT_DIR, {recursive: true}); await field.scrollIntoViewIfNeeded();
    await page.screenshot({path: `${process.env.AUTHENTICATOR_EDIT_RECEIPT_DIR}/${locale}-${theme}-${width}-${flow}.png`, fullPage: true});
   }
  } finally {await page.close();}
 });
}

// Clearing every error on input would hide these actual server responses and retry waits.
for (const locale of ['en', 'es'] as const) for (const status of [0, 400, 403, 429, 503] as const) {
 const uncertain = status === 0 || status === 503;
 for (const flow of uncertain ? ['remove'] as const : ['login', 'remove', 'activate'] as const) test(`${locale} ${flow} ${status}: authenticator code edits preserve server feedback`, async () => {
  const {page, c, input, submit, feedback, writes, enter} = await open(flow, locale, 'light', 390, status);
  try {
   await enter('123456');
   await (uncertain ? page.getByRole('button', {name: c.factorReplace, exact: true}) : submit).click();
   const message = uncertain ? c.factorChangeUncertain : status === 400 ? (flow === 'login' ? c.factorUnavailable : c.factorCheckSettings) : status === 403 ? c.credentials : c.limited;
   await feedback.getByText(message, {exact: true}).waitFor();
   await input.fill('654321');
   assert.equal(await feedback.getByText(message, {exact: true}).count(), 1);
   assert.equal(await input.getAttribute('aria-invalid'), 'false'); assert.equal(writes.length, 1);
   if (status === 429) assert.equal(await submit.isDisabled(), true);
  } finally {await page.close();}
 });
}
