import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
for (const locale of ['en', 'es'] as const) test(`${locale}: country refusal preserves signup details and translates after a language change`, async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({locale, viewport: {width: 390, height: 1000}}), c = translations[locale];
    page.setDefaultTimeout(4000);
    const calls: Record<string, string>[] = [];
    await page.route('https://portal.test/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/session')) return route.fulfill({status: 401, json: {error: 'unauthenticated'}});
      const body = route.request().postDataJSON(); calls.push(body);
      return route.fulfill(body.countryCode === 'FR' ? {status: 400, json: {error: 'country_unavailable'}}
        : {status: 201, json: {accountId: 'owner', organisationId: 'organisation', legalBusinessId: 'business'}});
    });
    await page.goto(`https://portal.test/signup#token=${'a'.repeat(43)}`);
    await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    const country = page.getByRole('combobox', {name: c.country, exact: true});
    assert.equal(await country.inputValue(), 'ES');
    await page.locator('input[name=password]').fill('A distinct café password');
    await page.locator('input[name=legalBusinessName]').fill('Café SL');
    await country.selectOption('FR');
    assert.equal(calls.length, 0, 'selection alone never submits');
    await page.getByRole('button', {name: c.create, exact: true}).click();
    const message = locale === 'en' ? "Waitron Cloud isn't available in France yet" : 'Waitron Cloud todavía no está disponible en Francia';
    await page.getByText(message, {exact: true}).waitFor();
    assert.deepEqual(calls[0], {token: 'a'.repeat(43), password: 'A distinct café password', legalBusinessName: 'Café SL', organisationName: 'Café SL', countryCode: 'FR'});
    assert.equal(await page.locator('wt-form-error-summary').evaluate(el => el === document.activeElement), true);
    const other = locale === 'en' ? 'es' : 'en', translated = translations[other];
    await page.getByRole('combobox', {name: c.language, exact: true}).selectOption(other);
    await page.getByText(other === 'en' ? "Waitron Cloud isn't available in France yet" : 'Waitron Cloud todavía no está disponible en Francia', {exact: true}).waitFor();
    const changedCountry = page.getByRole('combobox', {name: translated.country, exact: true});
    assert.equal(await changedCountry.inputValue(), 'FR');
    assert.equal(await page.locator('input[name=password]').inputValue(), 'A distinct café password');
    assert.equal(await page.locator('input[name=legalBusinessName]').inputValue(), 'Café SL');
    await changedCountry.selectOption('ES');
    assert.equal(await page.getByRole('alert').count(), 0);
    await page.getByRole('button', {name: translated.create, exact: true}).click();
    await page.getByText(translated.signupReady, {exact: true}).waitFor();
    assert.equal(calls.length, 2); assert.equal(calls[1]!.countryCode, 'ES'); assert.equal(calls[1]!.token, calls[0]!.token);
  } finally {await browser.close();}
});
