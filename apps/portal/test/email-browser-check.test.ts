import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright';
import {loadPortalAssets, portalResponse} from '../../../packages/account-http/src/portal.ts';
import {browserCheckWorker} from '../../../packages/remote-access/src/browser-check.ts';
import {translations} from '../src/locale.ts';

async function servePortal(page: Page) {
  const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
  await page.route('https://portal.test/**', async route => {
    const response = portalResponse(new Request(route.request().url()), assets);
    await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
  });
}

test('the email forms allow a fresh browser check after a worker fails', async t => {
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
      await servePortal(page);
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
      const alert = page.getByRole('alert').getByText(copy, {exact: true});
      await alert.waitFor();
      assert.equal(await alert.evaluate(element => getComputedStyle(element).borderInlineStartStyle), 'solid');
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

for (const {path, form, button} of [
  {path: '/signup', form: '/signup/request', button: 'Continue'},
  {path: '/forgot-password', form: '/password-reset/request', button: 'Send reset link'},
]) test(`a server refusal requires a fresh challenge before retrying ${form}`, async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(4000);
  await servePortal(page);
  let challenges = 0;
  const proofs: string[] = [];
  await page.route('**/api/account/browser-check', route => route.fulfill({json: {challenge: `synthetic.${++challenges}`, difficulty: 8}}));
  await page.route('**/api/account/browser-check.js', route => route.fulfill({contentType: 'text/javascript', body: browserCheckWorker}));
  await page.route(`**/api/account${form}`, route => {
    proofs.push(JSON.parse(route.request().headers()['x-waitron-browser-proof'] ?? '{}').challenge);
    return route.fulfill(proofs.length === 1 ? {status: 403, json: {error: 'browser_check_required'}}
      : {status: 202, json: {status: 'accepted'}});
  });
  await page.goto(`https://portal.test${path}`);
  const email = page.getByLabel('Email');
  await email.fill('venue@example.test');
  const submit = page.getByRole('button', {name: button, exact: true});
  await submit.click();
  const alert = page.getByRole('alert').getByText('The browser check failed. Try again or use another browser.');
  await alert.waitFor();
  assert.equal(await alert.evaluate(element => element === document.activeElement), true);
  assert.equal(await email.inputValue(), 'venue@example.test');
  assert.deepEqual(proofs, ['synthetic.1']);
  await submit.click();
  await page.getByRole('heading', {name: 'Check your email', exact: true}).waitFor();
  assert.deepEqual(proofs, ['synthetic.1', 'synthetic.2']);
});

for (const cause of ['navigation', 'deadline'] as const) test(`a stalled browser worker stops on ${cause}`, {timeout: cause === 'navigation' ? 8_000 : 35_000}, async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(4000);
  await servePortal(page);
  let emailRequests = 0;
  await page.route('**/api/account/signup/request', route => {
    emailRequests++;
    return route.fulfill({status: 202, json: {status: 'accepted'}});
  });
  await page.route('**/api/account/browser-check', route => route.fulfill({json: {challenge: 'synthetic', difficulty: 8}}));
  await page.route('**/api/account/browser-check.js', route => route.fulfill({contentType: 'text/javascript', body: 'onmessage = () => {};'}));
  await page.goto('https://portal.test/signup');
  await page.getByLabel('Email').fill('venue@example.test');
  const submit = page.getByRole('button', {name: 'Continue', exact: true});
  const [worker] = await Promise.all([page.waitForEvent('worker'), submit.click()]);
  const stopped = new Promise<void>(resolve => worker.once('close', () => resolve()));
  if (cause === 'navigation') {
    await page.getByRole('link', {name: 'Sign in', exact: true}).click();
    await page.getByRole('heading', {name: 'Sign in', exact: true}).waitFor();
  } else {
    await page.getByRole('alert').getByText('The browser check failed. Try again or use another browser.').waitFor({timeout: 30_000});
    assert.equal(await submit.isEnabled(), true);
  }
  await stopped;
  assert.equal(emailRequests, 0);
});
