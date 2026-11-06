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
const token = 'a'.repeat(43), password = ' A café owner password ';
const flows = [
  {path: '/signup', endpoint: '/signup/request', button: 'continue', status: 202, value: {status: 'accepted'}},
  {path: '/forgot-password', endpoint: '/password-reset/request', button: 'sendReset', status: 202, value: {status: 'accepted'}},
  {path: '/signup', endpoint: '/signup/complete', button: 'create', status: 201,
    value: {accountId: 'owner', organisationId: 'organisation', legalBusinessId: 'business'}},
  {path: '/reset-password', endpoint: '/password-reset/complete', button: 'savePassword', status: 200, value: {status: 'completed'}},
] as const;

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: signup/reset only report exact acknowledgements`, async t => {
    const browser = await chromium.launch({headless: true}), c = translations[locale];
    try {
      for (const flow of flows) await t.test(flow.endpoint, async () => {
        const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 1000}});
        page.setDefaultTimeout(4000);
        const completion = flow.endpoint.endsWith('/complete'), calls: {path: string; body: unknown; headers: Record<string, string>}[] = [], errors: string[] = [];
        let valid = false;
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.route('https://portal.test/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
          await page.route('**/api/account/**', route => {
            const request = route.request(), endpoint = new URL(request.url()).pathname.replace('/api/account', '');
            if (endpoint === '/session') return route.fulfill({status: 401, json: {error: 'unauthenticated'}});
            calls.push({path: endpoint, body: request.postDataJSON(), headers: request.headers()});
            return route.fulfill({status: valid ? flow.status : flow.status === 200 ? 202 : 200, json: flow.value});
          });
          await page.goto(`https://portal.test${flow.path}${completion ? '#token=' + token : ''}`);
          await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
          if (completion) await page.locator('input[name=password]').fill(password);
          else await page.locator('input[name=email]').fill('owner@example.test');
          if (flow.endpoint === '/signup/complete') await page.locator('input[name=legalBusinessName]').fill('Café SL');
          const submit = page.getByRole('button', {name: c[flow.button], exact: true});
          await submit.click();
          await page.getByText(completion ? c.uncertain : c.unavailable, {exact: true}).waitFor();
          assert.equal(calls.length, 1);
          assert.equal(await submit.isEnabled(), true, 'uncertainty allows an explicit retry');
          assert.equal(await page.getByText(c.signupReady, {exact: true}).count(), 0);
          assert.equal(await page.getByText(c.resetReady, {exact: true}).count(), 0);
          assert.equal(await page.getByRole('heading', {name: c.checkEmail, exact: true}).count(), 0);
          if (completion) assert.equal(await page.locator('input[name=password]').inputValue(), password);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          const output = process.env.SIGNUP_ACK_RECEIPT_DIR;
          if (output) {
            await mkdir(output, {recursive: true});
            await page.screenshot({path: `${output}/${locale}-${theme}-${width}-${flow.endpoint.replaceAll('/', '-')}.png`, fullPage: true});
          }
          valid = true;
          await submit.click();
          await page.getByText(completion ? flow.endpoint === '/signup/complete' ? c.signupReady : c.resetReady : c.emailSent, {exact: true}).waitFor();
          assert.equal(calls.length, 2, 'only the deliberate retry sends another request');
          const body = completion ? flow.endpoint === '/signup/complete'
            ? {token, password, legalBusinessName: 'Café SL', organisationName: 'Café SL', countryCode: 'ES'}
            : {token, password, locale} : {email: 'owner@example.test', locale};
          for (const call of calls) {
            assert.equal(call.path, flow.endpoint);
            assert.deepEqual(call.body, body);
            assert.equal(call.headers.origin, 'https://portal.test');
            assert.equal(call.headers['content-type'], 'application/json');
            assert.equal(call.headers['x-csrf-token'], undefined, 'public actions use the server origin check');
          }
          assert.deepEqual(errors, []);
        } finally {await page.close();}
      });
    } finally {await browser.close();}
  });
}
