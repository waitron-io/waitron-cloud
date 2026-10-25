import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium, type Page} from 'playwright';
import {translations} from '../src/locale.ts';

const requestId = '10000000-0000-4000-8000-000000000001';
const localVenueId = '10000000-0000-4000-8000-000000000002';
const businesses = [
  {organisationId: '20000000-0000-4000-8000-000000000001', legalBusinessId: '30000000-0000-4000-8000-000000000001', organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES'},
  {organisationId: '20000000-0000-4000-8000-000000000002', legalBusinessId: '30000000-0000-4000-8000-000000000002', organisationName: 'Bar Luna', legalBusinessName: 'Luna SL', countryCode: 'ES'},
];
const view = {requestId, localVenueId, environment: 'test', state: 'awaiting_cloud', expiresAt: '2099-01-01T00:00:00Z'};
const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

async function start(page: Page, single = false) {
  const writes: {path: string; body: unknown}[] = [];
  let failure: {status: number; error: string} | undefined;
  await page.route('https://portal.test/connect', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/account', '');
    if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
    if (path === '/pairing/businesses') return route.fulfill({json: {businesses: single ? [businesses[0]] : businesses}});
    if (request.method() === 'POST') writes.push({path, body: request.postDataJSON()});
    if (path === '/pairing/inspect') return route.fulfill({json: view});
    if (path === '/pairing/approve') {
      if (failure) return route.fulfill({status: failure.status, json: {error: failure.error}});
      const chosen = businesses.find(b => b.legalBusinessId === request.postDataJSON().legalBusinessId)!;
      return route.fulfill({json: {...view, ...chosen, state: 'awaiting_local'}});
    }
    return route.fulfill({status: 503, json: {error: 'unavailable'}});
  });
  await page.goto(`https://portal.test/connect#request=${requestId}`);
  await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
  await page.locator('wt-input[name=pairingCode] input').waitFor();
  return {writes, fail: (value: typeof failure) => {failure = value;}};
}

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: choosing a business clears the choose-a-business message`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}}); page.setDefaultTimeout(4000);
      const c = translations[locale], api = await start(page);
      const code = page.locator('wt-input[name=pairingCode] input');
      await page.getByRole('button', {name: c.pairInspect, exact: true}).click();
      await page.getByRole('alert').filter({hasText: c.pairCodeError}).waitFor();
      assert.deepEqual(api.writes, [], 'a blank code is refused locally');
      await code.fill('12345678'); await page.getByRole('button', {name: c.pairInspect, exact: true}).click();
      const choice = page.locator('select[name=legalBusinessId]'), approve = page.getByRole('button', {name: c.pairApprove, exact: true});
      await choice.waitFor(); assert.equal(await choice.inputValue(), '');
      await approve.click(); await page.getByRole('alert').filter({hasText: c.pairChoice}).waitFor();
      assert.equal(api.writes.length, 1, 'approval without a business sends no request');
      assert.equal(await choice.getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#business-error').textContent(), c.pairChoice);
      await choice.selectOption('');
      assert.equal(await choice.getAttribute('aria-invalid'), 'true', 'an empty choice has not resolved the error');
      await choice.selectOption(businesses[0]!.legalBusinessId);
      assert.equal(await choice.inputValue(), businesses[0]!.legalBusinessId);
      assert.equal(await choice.getAttribute('aria-invalid'), 'false');
      assert.equal(await page.locator('#business-error').textContent(), '');
      assert.equal(await page.getByRole('alert').count(), 0, 'resolved feedback also leaves the error summary');
      assert.equal(api.writes.length, 1, 'choosing does not approve');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PAIRING_CHOICE_RECEIPT_DIR) {
        await mkdir(process.env.PAIRING_CHOICE_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.PAIRING_CHOICE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`, fullPage: true});
      }
      for (const [status, error, expected] of [
        [403, 'permission_denied', c.pairPermission],
        [404, 'pairing_unavailable', c.pairUnavailable],
        [503, 'unavailable', c.pairUncertain],
      ] as const) {
        api.fail({status, error}); await approve.click(); await page.getByRole('alert').filter({hasText: expected}).waitFor();
        const before: number = api.writes.length;
        await choice.selectOption(await choice.inputValue() === businesses[0]!.legalBusinessId ? businesses[1]!.legalBusinessId : businesses[0]!.legalBusinessId);
        assert.equal(await page.getByRole('alert').filter({hasText: expected}).count(), 1, 'business edits preserve server refusals and uncertainty');
        assert.equal(await choice.getAttribute('aria-invalid'), 'false');
        assert.equal(api.writes.length, before);
      }
      await page.evaluate(() => {const app = (window as any).app; app.pairing.codeError = true; app.pairing.error = 'pairCodeError'; app.draw();});
      await choice.selectOption(businesses[1]!.legalBusinessId);
      assert.equal(await page.getByRole('alert').filter({hasText: c.pairCodeError}).count(), 1);
      assert.equal(await code.getAttribute('aria-invalid'), 'true', 'business edits do not clear a code error');
      await choice.selectOption(''); await approve.click();
      await page.getByRole('alert').filter({hasText: c.pairChoice}).waitFor();
      const before: number = api.writes.length;
      await choice.selectOption(businesses[1]!.legalBusinessId);
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(api.writes.length, before);
      api.fail(undefined); await approve.click(); await page.getByText(c.pairApproved, {exact: true}).waitFor();
      assert.deepEqual(api.writes.at(-1), {path: '/pairing/approve', body: {requestId, code: '12345678', organisationId: businesses[1]!.organisationId, legalBusinessId: businesses[1]!.legalBusinessId}});
      await page.close();
    } finally { await browser.close(); }
  });
}

for (const locale of ['en', 'es'] as const) test(`${locale}: a single business still approves without a choice list`, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({locale}); page.setDefaultTimeout(4000);
    const c = translations[locale], api = await start(page, true);
    await page.locator('wt-input[name=pairingCode] input').fill('12345678');
    await page.getByRole('button', {name: c.pairInspect, exact: true}).click();
    await page.getByRole('button', {name: c.pairApprove, exact: true}).click();
    await page.getByText(c.pairApproved, {exact: true}).waitFor();
    assert.equal(await page.locator('select[name=legalBusinessId]').count(), 0);
    assert.deepEqual(api.writes, [{path: '/pairing/inspect', body: {requestId, code: '12345678'}}, {path: '/pairing/approve', body: {requestId, code: '12345678', organisationId: businesses[0]!.organisationId, legalBusinessId: businesses[0]!.legalBusinessId}}]);
  } finally { await browser.close(); }
});
