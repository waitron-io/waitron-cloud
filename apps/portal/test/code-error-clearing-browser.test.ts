import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import {translations, type Locale} from '../src/locale.ts';

const requestId = '12345678-1234-4234-8234-123456789abc';
const business = {organisationId: requestId, legalBusinessId: '22345678-1234-4234-8234-123456789abc', organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES'};
const flows = [{path: '/connect', field: 'pairingCode', controller: 'pairing'}, {path: '/recover', field: 'recoveryCode', controller: 'recovery'}] as const;
type Flow = typeof flows[number];
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
let browser: Browser;
before(async () => {browser = await chromium.launch({headless: true});});
after(async () => {await browser?.close();});

async function open(browser: Browser, flow: Flow, locale: Locale, theme: 'light'|'dark', width: number, failure = 503) {
 const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
 page.setDefaultTimeout(3000);
 const calls: {path: string; body: unknown}[] = [], errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.route('https://portal.test/**', route => {
  const path = new URL(route.request().url()).pathname.replace('/api/account', '');
  if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
  if (path === '/pairing/businesses') return route.fulfill({json: {businesses: [business]}});
  if (path === '/installations') return route.fulfill({json: {installations: []}});
  if (path.endsWith('/inspect')) {
   calls.push({path, body: route.request().postDataJSON()});
   if (failure === 0) return route.abort('connectionreset');
   return route.fulfill({status: failure, json: {error: failure === 404 ? 'pairing_unavailable' : failure === 429 ? 'rate_limited' : 'unavailable'}});
  }
  if (new URL(route.request().url()).pathname.startsWith('/api/')) throw new Error('unexpected API request: ' + path);
  return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
 });
 await page.goto(`https://portal.test${flow.path}#request=${requestId}`);
 await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
 const field = page.locator(`wt-input[name=${flow.field}]`), input = field.locator('input');
 await input.waitFor();
 return {page, field, input, calls, errors};
}

// Removing either edit handler's feedback clearing leaves the old field marker and alert.
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
 test(`${locale} ${theme} ${width}: typing a new code clears the malformed-code message`, async t => {
  const c = translations[locale];
   for (const flow of flows) await t.test(flow.path, async () => {
    const {page, field, input, calls, errors} = await open(browser, flow, locale, theme, width);
    try {
     const submit = page.getByRole('button', {name: c.pairInspect, exact: true});
     for (const code of ['1234', '1234 5678', '1234567x']) {
      await input.fill(code); await submit.click();
      await page.getByRole('alert').filter({hasText: c.pairCodeError}).waitFor();
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      await field.getByText(c.pairCodeError, {exact: true}).waitFor();
      assert.deepEqual(calls, [], 'malformed codes are refused before a request');
      await input.fill('12345678');
      assert.equal(await input.getAttribute('aria-invalid'), 'false');
      assert.equal(await field.getByText(c.pairCodeError, {exact: true}).count(), 0);
      assert.equal(await page.getByRole('alert').count(), 0, 'the summary clears as well as the field');
      assert.equal(await input.inputValue(), '12345678');
      assert.deepEqual(calls, [], 'editing never inspects or approves');
     }
     await input.fill(''); await submit.click();
     await page.getByRole('alert').filter({hasText: c.pairCodeError}).waitFor();
     await input.fill('7');
     assert.equal(await input.getAttribute('aria-invalid'), 'false', 'an edit clears the previous submission feedback');
     await submit.click();
     await page.getByRole('alert').filter({hasText: c.pairCodeError}).waitFor();
     assert.equal(await input.getAttribute('aria-invalid'), 'true', 'submit checks the edited code again');
     assert.deepEqual(calls, []);
     await input.fill(' 01234567 ');
     const other = locale === 'en' ? 'es' : 'en';
     await page.getByRole('combobox').selectOption(other);
     assert.equal(await input.inputValue(), ' 01234567 ', 'a redraw retains the edited code');
     assert.equal(await input.getAttribute('aria-invalid'), 'false');
     assert.equal(await page.getByRole('alert').count(), 0);
     assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
     if (process.env.CODE_ERROR_RECEIPT_DIR) {
      await mkdir(process.env.CODE_ERROR_RECEIPT_DIR, {recursive: true});
      await page.screenshot({path: `${process.env.CODE_ERROR_RECEIPT_DIR}/${flow.controller}-${other}-${theme}-${width}.png`, fullPage: true});
     }
     await page.getByRole('button', {name: translations[other].pairInspect, exact: true}).click();
     await page.getByRole('alert').filter({hasText: translations[other].unavailable}).waitFor();
     assert.deepEqual(calls, [{path: `/${flow.controller}/inspect`, body: {requestId, code: '01234567'}}]);
     assert.equal(await input.inputValue(), '01234567');
     assert.deepEqual(errors, []);
    } finally {await page.close();}
   });
 });
}

// Clearing every error on an edit would hide these server refusals and unknown outcomes.
for (const locale of ['en', 'es'] as const) for (const flow of flows) {
 for (const failure of [0, 403, 404, 429, 503]) test(`${locale} ${flow.path} ${failure}: code edits preserve server feedback`, async () => {
  const c = translations[locale];
   const {page, input, calls, errors} = await open(browser, flow, locale, 'light', 390, failure);
   try {
    await input.fill('12345678'); await page.getByRole('button', {name: c.pairInspect, exact: true}).click();
    const message = failure === 429 ? c.limited : flow.controller === 'pairing' && failure === 403 ? c.pairPermission : flow.controller === 'pairing' && failure === 404 ? c.pairUnavailable : flow.controller === 'recovery' && failure === 403 ? c.forbidden : c.unavailable;
    await page.getByRole('alert').filter({hasText: message}).waitFor();
    await input.fill('87654321');
    assert.equal(await page.getByRole('alert').filter({hasText: message}).count(), 1);
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
    assert.equal(await input.inputValue(), '87654321');
    assert.equal(calls.length, 1, 'editing never retries the request'); assert.deepEqual(errors, []);
   } finally {await page.close();}
 });
 test(`${locale} ${flow.path}: code edits preserve an uncertain write`, async () => {
  const c = translations[locale];
   const {page, field, input, calls, errors} = await open(browser, flow, locale, 'light', 390);
   try {
    await input.fill('12345678');
    // A write normally disables code editing; exercise a late edit event defensively.
    await page.evaluate(controller => {
     const app = (window as any).app;
     app[controller].error = controller === 'pairing' ? 'pairUncertain' : 'recoveryUncertain';
     if (controller === 'recovery') app.recovery.uncertain = true;
     app.draw();
    }, flow.controller);
    const message = flow.controller === 'pairing' ? c.pairUncertain : c.recoveryUncertain;
    await page.getByRole('alert').filter({hasText: message}).waitFor();
    await field.evaluate(element => element.dispatchEvent(new CustomEvent('wt-change', {detail: {value: '87654321'}, bubbles: true, composed: true})));
    assert.equal(await page.getByRole('alert').filter({hasText: message}).count(), 1);
    if (flow.controller === 'recovery') assert.equal(await page.evaluate(() => (window as any).app.recovery.uncertain), true);
    assert.deepEqual(calls, []); assert.deepEqual(errors, []);
   } finally {await page.close();}
 });
}
