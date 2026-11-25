import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright';
import {loadPortalAssets, portalResponse, turnstilePortalAssets} from '../../../packages/account-http/src/portal.ts';
import {translations} from '../src/locale.ts';
import {interceptTurnstile} from './turnstile-fixture.ts';

const pairingRequestId = '11111111-1111-4111-8111-111111111111';

async function servePortal(page: Page, enabled: () => boolean = () => true) {
  const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
  const turnstile = turnstilePortalAssets(assets, 'test-site');
  await page.route('https://portal.test/**', async route => {
    if (route.request().url().endsWith('/api/account/session')) return route.fulfill({status: 401, json: {error: 'unauthenticated'}});
    const response = portalResponse(new Request(route.request().url()), assets, false, false, enabled() ? turnstile : undefined);
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
        return route.fulfill(proofs.length === 1 ? {status: signUp ? 400 : 503, json: {error: 'browser_check_failed'}}
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
      if (locale === 'en' && colorScheme === 'light' && width === 390 && signUp) {
        await widget.dispatchEvent('error-fixture');
        await alert.waitFor();
        await page.getByRole('button', {name: c.retry, exact: true}).click();
      }
      await widget.click();
      await email.focus();
      await widget.dispatchEvent('expire-fixture');
      assert.equal(await widget.evaluate(element => element === document.activeElement), true);
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
  const documents: string[] = [];
  page.on('request', request => {
    if (request.isNavigationRequest()) documents.push(new URL(request.url()).pathname);
  });
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto(`https://portal.test/connect#request=${pairingRequestId}&lang=es`);
  await page.getByRole('link', {name: translations.es.forgot, exact: true}).click();
  await page.getByRole('button', {name: 'Verificar (simulación)'}).waitFor();
  await page.getByRole('link', {name: translations.es.login, exact: true}).click();
  await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
  assert.deepEqual(documents, ['/connect', '/forgot-password', '/login']);
  assert.equal(await page.evaluate(() => history.state.pairingRequestId), pairingRequestId);
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

test('opening a sign-up completion link in the request tab unloads the widget and keeps the pairing request', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(3000);
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto(`https://portal.test/connect#request=${pairingRequestId}&lang=es`);
  await page.getByRole('link', {name: translations.es.signup, exact: true}).click();
  await page.getByRole('button', {name: 'Verificar (simulación)'}).waitFor({timeout: 2000});
  await page.goto(`https://portal.test/signup#token=${'b'.repeat(43)}`);
  await page.locator('input[name=password]').waitFor({timeout: 3000});
  assert.equal(await page.evaluate(() => typeof window.turnstile), 'undefined');
  assert.equal(new URL(page.url()).hash, '');
  await page.getByRole('link', {name: 'Waitron Cloud', exact: true}).click();
  await page.waitForURL('**/login');
  await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
  assert.equal(await page.evaluate(() => history.state.pairingRequestId), pairingRequestId);
});

test('browser Back from password reset keeps the recovery request and link language', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(3000);
  let signedIn = false;
  await servePortal(page);
  await page.route('**/api/account/session', route => signedIn
    ? route.fulfill({json: {accountId: 'test-owner', expiresAt: '2099-01-01T00:00:00Z'}}) : route.fallback());
  await page.route('**/api/account/login', route => {
    signedIn = true;
    return route.fulfill({json: {accountId: 'test-owner'}});
  });
  await interceptTurnstile(page);
  await page.goto('https://portal.test/recover#request=11111111-1111-4111-8111-111111111111&lang=es');
  await page.getByRole('link', {name: translations.es.forgot, exact: true}).click();
  await page.getByRole('button', {name: 'Verificar (simulación)'}).waitFor();
  await page.goBack();
  await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
  await page.getByLabel(translations.es.email).fill('owner@example.test');
  await page.locator('input[name=password]').fill('A browser test password');
  await page.getByRole('button', {name: translations.es.login, exact: true}).click();
  await page.waitForURL('**/recover');
  await page.locator('input[name=recoveryCode]').waitFor();
});

test('a tab opened before Turnstile activation can reload to get the widget', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(3000);
  let enabled = false;
  await servePortal(page, () => enabled);
  await interceptTurnstile(page);
  await page.route('**/api/account/signup/request', route => route.fulfill({status: 400, json: {error: 'browser_check_failed'}}));
  await page.goto('https://portal.test/signup');
  await page.getByLabel(translations.en.email).fill('owner@example.test');
  enabled = true;
  await page.getByRole('button', {name: translations.en.continue, exact: true}).click();
  await page.getByRole('button', {name: translations.en.retry, exact: true}).click();
  await page.getByRole('button', {name: 'Verify (stand-in)'}).waitFor();
});

test('changing the form language asks for a new proof in that language', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(3000);
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto('https://portal.test/signup');
  await page.getByLabel(translations.en.email).fill('owner@example.test');
  await page.getByRole('button', {name: 'Verify (stand-in)'}).click();
  assert.equal(await page.getByRole('button', {name: translations.en.continue, exact: true}).isEnabled(), true);
  await page.getByRole('combobox').selectOption('es');
  await page.getByRole('button', {name: 'Verificar (simulación)'}).waitFor();
  assert.equal(await page.getByRole('button', {name: translations.es.continue, exact: true}).isDisabled(), true);
  assert.equal(await page.getByLabel(translations.es.email).inputValue(), 'owner@example.test');
});

test('a restored request page drops its proof each time it leaves', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(3000);
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto('https://portal.test/signup');
  const widget = page.getByRole('button', {name: 'Verify (stand-in)'});
  const submit = page.getByRole('button', {name: translations.en.continue, exact: true});
  for (let pass = 0; pass < 2; pass++) {
    await widget.click();
    assert.equal(await submit.isEnabled(), true);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})));
    assert.equal(await widget.count(), 0);
    assert.equal(await submit.isDisabled(), true);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
  }
});

test('the widget fits a narrow phone at its real dimensions', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en', viewport: {width: 320, height: 800}});
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto('https://portal.test/signup');
  await page.getByRole('button', {name: 'Verify (stand-in)'}).waitFor({timeout: 3000});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('an explicit language choice survives Back and reload', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({locale: 'en'});
  page.setDefaultTimeout(3000);
  await servePortal(page);
  await interceptTurnstile(page);
  await page.goto('https://portal.test/login');
  await page.getByRole('link', {name: translations.en.forgot, exact: true}).click();
  await page.getByRole('combobox').selectOption('es');
  await page.goBack();
  await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
  await page.reload();
  await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
});

for (const transition of ['switching the keys off', 'browser Forward']) {
  test(`a pairing request and its language survive ${transition}`, async t => {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({locale: 'en'});
    page.setDefaultTimeout(3000);
    let enabled = true;
    await servePortal(page, () => enabled);
    await interceptTurnstile(page);
    await page.goto(`https://portal.test/connect#request=${pairingRequestId}&lang=es`);
    if (transition === 'switching the keys off') enabled = false;
    await page.getByRole('link', {name: translations.es.forgot, exact: true}).click();
    if (enabled) {
      await page.getByRole('button', {name: 'Verificar (simulación)'}).waitFor();
      await page.goBack();
      await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
      await page.goForward();
    }
    await page.getByRole('link', {name: translations.es.login, exact: true}).click();
    await page.waitForURL('**/login');
    await page.getByRole('heading', {name: translations.es.login, exact: true}).waitFor();
    assert.equal(await page.evaluate(() => history.state?.pairingRequestId), pairingRequestId);
  });
}
