import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { SignupStore, RegistrationStore } from '@waitron-cloud/registration';
import { createSession } from '@waitron-cloud/identity';
import { transaction } from '../../../packages/registration/src/transaction.ts';
import { authorityFixture } from '../../../packages/fiscal-allocation/test/continuity-fixture.ts';
import { testOptions } from '../../../packages/fiscal-allocation/test/store-fixture.ts';
import { key, bases, reserve } from '../../../packages/fiscal-allocation/test/fixtures.ts';
import { startPortalFixture } from './fixtures.ts';
import { translations } from '../src/locale.ts';

// Expose the real app only in this test bundle, so a supplied draft can precede
// the fiscal screen's first render without adding a production debugging API.
const bundle = await build({ stdin: { contents: `
  import { applyTokens } from '@waitron-io/ui-core/tokens';
  import { PortalApp } from './src/app.ts';
  applyTokens(document.body);
  window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'iife', target: 'es2023' });

test('supplied fiscal selectors agree with the untouched request and real server reservation', async t => {
  const authority = await authorityFixture();
  let fixture: Awaited<ReturnType<typeof startPortalFixture>> | undefined;
  try {
    fixture = await startPortalFixture(undefined, undefined, undefined, testOptions(authority.adapter()));
    const { db } = fixture, signup = new SignupStore(db.pool, db.outbox);
    await signup.request('selector-owner@example.test');
    const mail = db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);
    assert('token' in mail);
    const owner = await signup.complete(mail.token, { password: 'A long synthetic owner password', organisationName: 'Z supplied organisation', legalBusinessName: 'Supplied venue', countryCode: 'ES' });
    const otherOrganisation = randomUUID(), otherBusiness = randomUUID();
    await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'A first organisation')", [otherOrganisation]);
    await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,true)', [owner.accountId, otherOrganisation]);
    await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name) VALUES($1,$2,'First venue')", [otherBusiness, otherOrganisation]);
    const registration = new RegistrationStore(db.pool);
    const register = async (organisationId: string, legalBusinessId: string) => {
      const input = { operationId: randomUUID(), installationKey: key().publicKey, localVenueId: randomUUID(), environment: 'test' as const, organisationId, legalBusinessId };
      await registration.start(input); await registration.approveCloud(input, owner.accountId); await registration.approveLocal(input, randomUUID());
      return registration.complete(input);
    };
    await register(otherOrganisation, otherBusiness);
    const venue = await register(owner.organisationId, owner.legalBusinessId);
    await db.pool.query('CREATE TABLE fiscal_test_authority(account_id uuid PRIMARY KEY,entitlement boolean NOT NULL DEFAULT true,custody boolean NOT NULL DEFAULT true,operator_verified boolean NOT NULL DEFAULT true,bases jsonb NOT NULL)');
    await db.pool.query('INSERT INTO fiscal_test_authority(account_id,bases) VALUES($1,$2)', [owner.accountId, JSON.stringify(bases)]);
    const session = await transaction(db.pool, c => createSession(c, owner.accountId));
    const context = await fixture.browser.newContext({ locale: 'en', viewport: { width: 390, height: 900 } }), page = await context.newPage();
    page.setDefaultTimeout(6000);
    await context.addCookies([{ name: 'cloud_session', value: session.token, url: fixture.origin, httpOnly: true }, { name: 'cloud_csrf', value: session.csrfToken, url: fixture.origin }]);
    await page.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0]!.text }));
    await page.goto(fixture.origin + '/account');
    await page.waitForFunction(() => (window as any).app.installations.loaded && !(window as any).app.waiting);
    const input = { ...reserve(), operationId: randomUUID(), venueId: venue.venueId, mode: 'initial-setup' as const };
    await page.evaluate(({ organisationId, input }) => {
      const app = (window as any).app;
      app.installations.selectOrganisation(organisationId);
      app.fiscal.open(input.venueId);
      app.fiscal.choose(input);
      history.pushState(null, '', '/fiscal-allocations');
      app.path = '/fiscal-allocations';
      app.draw();
    }, { organisationId: owner.organisationId, input });
    const c = translations.en;
    const shown = {
      organisationId: await page.getByLabel(c.recoveryOrganisation, { exact: true }).inputValue(),
      venueId: await page.getByLabel(c.fiscalVenue, { exact: true }).inputValue(),
      mode: await page.getByLabel(c.fiscalMode, { exact: true }).inputValue(),
    };
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/account/fiscal-allocations/reserve'));
    await page.getByRole('button', { name: c.fiscalReserve, exact: true }).click();
    const response = await responsePromise, sent = response.request().postDataJSON(), receipt = await response.json();
    const stored = (await db.pool.query('SELECT a.initial_receipt,v.organisation_id FROM fiscal_registry_allocations a JOIN venues v ON v.id=a.venue_id WHERE a.venue_id=$1', [venue.venueId])).rows;
    console.log('FISCAL_SELECTOR_JOURNEY', JSON.stringify({ shown, supplied: { organisationId: owner.organisationId, venueId: input.venueId, mode: input.mode }, sent: { venueId: sent.venueId, mode: sent.mode, organisationId: sent.organisationId ?? null }, status: response.status(), stored: stored.map(row => ({ organisationId: row.organisation_id, venueId: row.initial_receipt.payload.venueId, mode: row.initial_receipt.payload.mode })) }));
    assert.equal(response.status(), 200);
    assert.deepEqual(sent, input);
    assert.equal(receipt.payload.venueId, venue.venueId);
    assert.equal(receipt.payload.mode, 'initial-setup');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].organisation_id, owner.organisationId);
    assert.equal(stored[0].initial_receipt.payload.venueId, venue.venueId);
    assert.equal(stored[0].initial_receipt.payload.mode, 'initial-setup');
    await t.test('organisation shown matches the reserved venue organisation', () => assert.equal(shown.organisationId, owner.organisationId));
    await t.test('venue shown matches the submitted and stored venue', () => assert.equal(shown.venueId, venue.venueId));
    await t.test('mode shown matches the submitted and stored mode', () => assert.equal(shown.mode, 'initial-setup'));
    await context.close();
  } finally { await fixture?.close(); await authority.close(); }
});
