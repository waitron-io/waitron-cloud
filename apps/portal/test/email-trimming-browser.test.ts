import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium, type Browser} from 'playwright';
import {translations, type Locale} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const flows = [
  {path: '/forgot-password', endpoint: '/password-reset/request', button: 'sendReset'},
  {path: '/signup', endpoint: '/signup/request', button: 'continue'},
  {path: '/login', endpoint: '/login', button: 'login'},
] as const;
const password = '  A café owner password  ';
async function open(browser: Browser, flow: typeof flows[number], locale: Locale, theme = 'light', width = 390) {
  const page = await browser.newPage({locale, colorScheme: theme as 'light' | 'dark', viewport: {width, height: 900}});
  page.setDefaultTimeout(3000);
  const calls: {path: string; body: unknown}[] = [];
  await page.route('https://portal.test' + flow.path, route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/account', '');
    if (path === '/session') return route.fulfill({status: 401, json: {error: 'credentials_invalid'}});
    calls.push({path, body: route.request().postDataJSON()});
    if (path === flow.endpoint) return flow.path === '/login'
      ? route.fulfill({status: 401, json: {error: 'credentials_invalid'}})
      : route.fulfill({status: 202, json: {status: 'accepted'}});
    return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
  });
  await page.goto('https://portal.test' + flow.path);
  await page.addStyleTag({content: styles});
  await page.addScriptTag({content: bundle.outputFiles[0]!.text});
  return {page, calls};
}

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: surrounding email spaces are removed before account requests`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      for (const flow of flows) for (const [kind, email] of [
        ['ordinary', ' owner@example.test '],
        ['nonbreaking', '\u00a0owner@example.test\u00a0'],
      ] as const) await t.test(`${flow.path} ${kind}`, async () => {
        const {page, calls} = await open(browser, flow, locale, theme, width), c = translations[locale];
        try {
          await page.locator('input[name=email]').fill(email);
          if (flow.path === '/login') await page.locator('input[name=password]').fill(password);
          await page.getByRole('button', {name: c[flow.button], exact: true}).click();
          assert.equal(await page.locator('wt-input[name=email]').getByText(c.emailError, {exact: true}).count(), 0, 'surrounding spaces must not produce an email error');
          await (flow.path === '/login' ? page.getByRole('alert').filter({hasText: c.credentials}) : page.getByRole('status').filter({hasText: c.emailSent})).waitFor();
          assert.deepEqual(calls, [{path: flow.endpoint, body: flow.path === '/login'
            ? {email: 'owner@example.test', password}
            : {email: 'owner@example.test', locale}}]);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (kind === 'nonbreaking' && process.env.EMAIL_TRIMMING_RECEIPT_DIR) {
            await mkdir(process.env.EMAIL_TRIMMING_RECEIPT_DIR, {recursive: true});
            await page.screenshot({path: `${process.env.EMAIL_TRIMMING_RECEIPT_DIR}/${locale}-${theme}-${width}-${flow.path.slice(1)}.png`, fullPage: true});
          }
        } finally { await page.close(); }
      });
    } finally { await browser.close(); }
  });
}

for (const locale of ['en', 'es'] as const) test(`${locale}: trimming still refuses invalid emails without a request`, async t => {
  const browser = await chromium.launch({headless: true});
  try {
    for (const flow of flows) for (const [kind, email] of [
      ['blank', '\u00a0 \u00a0'], ['internal space', 'owner @example.test'], ['missing domain', 'owner@'],
      ['too long', 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(62)],
    ]) await t.test(`${flow.path} ${kind}`, async () => {
      const {page, calls} = await open(browser, flow, locale), c = translations[locale];
      try {
        await page.locator('input[name=email]').fill(email!);
        if (flow.path === '/login') await page.locator('input[name=password]').fill(password);
        await page.getByRole('button', {name: c[flow.button], exact: true}).click();
        await page.locator('wt-input[name=email]').getByText(c.emailError, {exact: true}).waitFor();
        assert.deepEqual(calls, [], 'invalid email must be refused before a request');
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
