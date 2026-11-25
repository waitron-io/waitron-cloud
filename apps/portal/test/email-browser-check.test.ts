import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright';
import {loadPortalAssets, portalResponse, turnstilePortalAssets} from '../../../packages/account-http/src/portal.ts';
import {translations} from '../src/locale.ts';
import {interceptTurnstile} from './turnstile-fixture.ts';

async function servePortal(page: Page) {
  const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
  const turnstile = turnstilePortalAssets(assets, 'test-site');
  await page.route('https://portal.test/**', async route => {
    if (route.request().url().endsWith('/api/account/session')) return route.fulfill({status: 401, json: {error: 'unauthenticated'}});
    const response = portalResponse(new Request(route.request().url()), assets, false, false, turnstile);
    await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
  });
}

test('both forms recover from a blocked check and send only a fresh proof', async t => {
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
      const action = signUp ? 'signup' : 'password_reset';
      let blocked = true;
      const proofs: string[] = [];
      await servePortal(page);
      await interceptTurnstile(page, {blocked: () => blocked});
      await page.route(`**/api/account${form}`, route => {
        proofs.push(route.request().postDataJSON().turnstileToken);
        return route.fulfill(proofs.length === 1 ? {status: 400, json: {error: 'browser_check_failed'}}
          : {status: 202, json: {status: 'accepted'}});
      });
      await page.goto(`https://portal.test${path}`);
      const email = page.getByLabel(c.email);
      await email.fill('venue@example.test');
      const submit = page.getByRole('button', {name: signUp ? c.continue : c.sendReset, exact: true});
      const copy = locale === 'en' ? 'The browser check failed. Try again or use another browser.'
        : 'No se pudo comprobar tu navegador. Vuelve a intentarlo o usa otro navegador.';
      const alert = page.getByRole('alert').getByText(copy, {exact: true});
      await alert.waitFor();
      assert.equal(await alert.evaluate(element => getComputedStyle(element).borderInlineStartStyle), 'solid');
      assert.equal(await email.inputValue(), 'venue@example.test');
      assert.equal(proofs.length, 0);
      const screen = async (stage: string) => {
        const output = process.env.SIGNUP_BROWSER_CHECK_RECEIPT_DIR;
        if (output) {
          await mkdir(output, {recursive: true});
          await page.screenshot({path: `${output}/${locale}-${colorScheme}-${width}-${path.slice(1)}-${stage}.png`, fullPage: true});
        }
      };
      await screen('blocked');
      blocked = false;
      await page.getByRole('button', {name: c.retry, exact: true}).click();
      const widget = page.getByRole('button', {name: locale === 'en' ? 'Verify (stand-in)' : 'Verificar (simulación)'});
      await widget.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await screen('widget');
      await widget.click();
      await widget.dispatchEvent('expire-fixture');
      assert.equal(await submit.isDisabled(), true);
      await widget.click();
      await submit.click();
      await alert.waitFor();
      assert.equal(await alert.evaluate(element => element === document.activeElement), true);
      assert.equal(await email.inputValue(), 'venue@example.test');
      assert.equal(await submit.isDisabled(), true);
      await widget.click();
      await submit.click();
      await page.getByRole('heading', {name: c.checkEmail}).waitFor();
      assert.equal(proofs.length, 2);
      assert.ok(proofs.every(proof => proof.startsWith(action + '-proof-')));
      assert.notEqual(proofs[0], proofs[1]);
      assert.equal(await widget.count(), 0, 'the resend cooldown postpones a new widget');
    });
  }
});

test('the password reset round trip preserves the pairing request and link language', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(3000);
  const requestId = '11111111-1111-4111-8111-111111111111';
  const documents: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest()) documents.push(new URL(request.url()).pathname);
  });
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto(`https://portal.test/connect#request=${requestId}&lang=es`);
  await page.getByRole('link', {name: translations.es.forgot, exact: true}).click();
  await page.getByRole('button', {name: 'Verificar (simulación)'}).waitFor();
  await page.getByRole('link', {name: translations.es.login, exact: true}).click();
  await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
  assert.deepEqual(documents, ['/connect', '/forgot-password', '/login']);
  assert.equal(await page.evaluate(() => history.state.pairingRequestId), requestId);
  assert.equal(await page.locator('html').getAttribute('lang'), 'es');
  assert.equal(await page.locator('script[src*="challenges.cloudflare.com"]').count(), 0);
});

test('an emailed completion link never loads the Turnstile script', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  let requested = 0;
  page.on('request', request => {if (request.url().startsWith('https://challenges.cloudflare.com')) requested++;});
  await servePortal(page);
  await interceptTurnstile(page);
  for (const path of ['/signup', '/reset-password']) {
    await page.goto(`https://portal.test${path}#token=${'a'.repeat(43)}`);
    await page.locator('input[name=password]').waitFor({timeout: 3000});
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(requested, 0);
  }
});

test('opening a sign-up completion link in the request tab unloads the widget', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto('https://portal.test/signup');
  await page.getByRole('button', {name: 'Verify (stand-in)'}).waitFor({timeout: 2000});
  await page.goto(`https://portal.test/signup#token=${'b'.repeat(43)}`);
  await page.locator('input[name=password]').waitFor({timeout: 3000});
  assert.equal(await page.evaluate(() => typeof window.turnstile), 'undefined');
  assert.equal(new URL(page.url()).hash, '');
});
