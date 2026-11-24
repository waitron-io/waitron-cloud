import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {loadPortalAssets, portalResponse} from '../../../packages/account-http/src/portal.ts';
import {browserCheckWorker} from '../../../packages/remote-access/src/browser-check.ts';
import {translations} from '../src/locale.ts';

test('the email forms allow a fresh browser check after a worker fails', async t => {
  const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const locale of ['en', 'es'] as const) for (const colorScheme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
    for (const path of ['/signup', '/forgot-password']) await t.test(`${locale} ${colorScheme} ${width} ${path}`, async t => {
      const page = await browser.newPage({locale, colorScheme, viewport: {width, height: 850}});
      t.after(() => page.close());
      page.setDefaultTimeout(3000);
      const c = translations[locale];
      const signUp = path === '/signup';
      const form = signUp ? '/signup/request' : '/password-reset/request';
      const proofs: unknown[] = [];
      let challenges = 0;
      let rejectWorker = true;
      let issue!: () => void, release!: () => void;
      const issuing = new Promise<void>(resolve => {issue = resolve;});
      const releaseChallenge = new Promise<void>(resolve => {release = resolve;});
      await page.route('https://portal.test/**', async route => {
        const response = portalResponse(new Request(route.request().url()), assets);
        await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
      });
      await page.route('**/api/account/browser-check', async route => {
        assert.deepEqual(route.request().postDataJSON(), {form});
        if (!challenges) {issue(); await releaseChallenge;}
        return route.fulfill({json: {challenge: `synthetic.${++challenges}`, difficulty: 8}});
      });
      await page.route('**/api/account/browser-check.js', route => rejectWorker ? route.abort()
        : route.fulfill({contentType: 'text/javascript', body: browserCheckWorker}));
      await page.route(`**/api/account${form}`, route => {
        proofs.push(JSON.parse(route.request().headers()['x-waitron-browser-proof'] ?? 'null'));
        return route.fulfill({status: 202, json: {status: 'accepted'}});
      });
      await page.goto(`https://portal.test${path}`);
      const email = page.getByLabel(c.email);
      await email.fill('venue@example.test');
      const submit = page.getByRole('button', {name: signUp ? c.continue : c.sendReset, exact: true});
      await submit.click();
      const output = process.env.SIGNUP_BROWSER_CHECK_RECEIPT_DIR;
      const screen = async (stage: string) => {
        if (!output) return;
        await mkdir(output, {recursive: true});
        await page.screenshot({path: `${output}/${locale}-${colorScheme}-${width}-${path.slice(1)}-${stage}.png`, fullPage: true});
      };
      try {
        await issuing;
        assert.equal(await page.getByRole('button', {name: c.browserChecking}).isDisabled(), true);
        await screen('waiting');
      } finally {release();}
      const copy = locale === 'en' ? 'The browser check failed. Try again or use another browser.'
        : 'No se pudo comprobar tu navegador. Vuelve a intentarlo o usa otro navegador.';
      await page.getByRole('alert').getByText(copy, {exact: true}).waitFor();
      assert.equal(await email.inputValue(), 'venue@example.test');
      assert.equal(await submit.isEnabled(), true);
      assert.equal(proofs.length, 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await screen('refused');
      rejectWorker = false;
      await submit.click();
      await page.getByRole('heading', {name: c.checkEmail}).waitFor();
      assert.deepEqual(proofs.map(proof => (proof as {challenge: string}).challenge), ['synthetic.2']);
    });
  }
});
