import {SignupStore} from '@waitron-cloud/registration';
import {signupVerification} from '../../../packages/account-http/test/fixtures.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareConnectionProof} from '../../../packages/registration/test/fixtures/action-proof.ts';
import {contextSignIn, startPortalFixture} from './fixtures.ts';

const copy = {
  en: {section: 'Your businesses', name: 'Legal business name', country: 'Country', tax: 'Tax number',
    register: 'Register a business', rename: 'Organisation name', save: 'Save name'},
  es: {section: 'Tus negocios', name: 'Nombre legal del negocio', country: 'País', tax: 'Número fiscal',
    register: 'Registrar un negocio', rename: 'Nombre de la organización', save: 'Guardar nombre'},
};

test('Account owners can register a business and rename the group', async t => {
  const f = await startPortalFixture();
  const password = 'A long enough business password';
  const email = 'business-owner@example.test';
  try {
    const signup = new SignupStore(f.db.pool, f.db.outbox);
    await signup.request(email);
    const {token} = await signupVerification(f.db, email);
    const owner = await signup.complete(token, {password, organisationName: 'Café Group', legalBusinessName: 'First SL', countryCode: 'ES'});
    await f.db.pool.query('INSERT INTO legal_businesses (id,organisation_id,name,country_code,tax_number) VALUES (gen_random_uuid(),$1,$2,$3,$4)',
      [owner.organisationId, 'Second SL', 'ES', 'ES-0123']);
    for (const locale of ['en', 'es'] as const) for (const colorScheme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
      await t.test(`${locale} ${colorScheme} ${width}`, async () => {
        const c = copy[locale];
        const context = await f.browser.newContext({locale, colorScheme, viewport: {width, height: 900}});
        try {
          const signedIn = await contextSignIn(f, context, email, password, locale);
          assert.equal(signedIn.status(), 200);
          const cookies = await context.cookies();
          await prepareConnectionProof(f.db.pool, owner.accountId, cookies.find(cookie => cookie.name === 'cloud_session')!.value);
          const page = await context.newPage();
          page.setDefaultTimeout(3000);
          await page.goto(f.origin + '/account#lang=' + locale);
          const panel = page.getByRole('region', {name: c.section});
          await panel.getByText('First SL', {exact: true}).waitFor();
          await panel.getByText('Second SL', {exact: true}).waitFor();
          await panel.getByText('ES-0123', {exact: true}).waitFor();
          if (locale === 'en' && colorScheme === 'light' && width === 390) {
            await panel.getByLabel(c.name, {exact: true}).fill('Third SL');
            await panel.getByLabel(c.tax, {exact: true}).fill('ES-0456');
            await panel.getByLabel(c.country, {exact: true}).selectOption('FR');
            await panel.getByRole('button', {name: c.register, exact: true}).click();
            const countryError = panel.getByText("Waitron Cloud isn't available in France yet", {exact: true});
            await countryError.waitFor();
            assert.equal(await countryError.count(), 1);
            await panel.getByLabel(c.country, {exact: true}).selectOption('ES');
            await panel.getByRole('button', {name: c.register, exact: true}).click();
            await panel.getByText('Third SL', {exact: true}).waitFor();
            await panel.getByLabel(c.rename, {exact: true}).fill('Renamed Group');
            await panel.getByRole('button', {name: c.save, exact: true}).click();
            await panel.getByRole('heading', {name: 'Renamed Group', exact: true}).waitFor();
            await page.locator('#owner-transfer-section').locator('option').filter({hasText: /^Renamed Group$/}).waitFor({state: 'attached'});
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await panel.screenshot({path: new URL(`../dist/account-businesses-${locale}-${colorScheme}-${width}.png`, import.meta.url).pathname});
          if (locale === 'es' && colorScheme === 'dark' && width === 1280) {
            await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1', [owner.accountId]);
            await Promise.all([
              page.waitForResponse(response => response.url().endsWith('/api/account/businesses') && response.ok()),
              page.reload(),
            ]);
            await panel.waitFor({state: 'hidden'});
          }
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    await f.close();
  }
});
