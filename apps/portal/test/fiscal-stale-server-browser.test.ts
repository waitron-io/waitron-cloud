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

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) for (const scenario of ['organisation-loading', 'venue-removed'] as const) test(`${scenario}: ${locale} ${theme} ${width}: supplied fiscal selectors agree with the untouched request and real server reservation`, async () => {
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
    const context = await fixture.browser.newContext({ locale, colorScheme: theme, viewport: { width, height: 900 } }), page = await context.newPage();
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
    const c = translations[locale];
    const organisation = page.getByLabel(c.recoveryOrganisation, { exact: true });
    const venueSelect = page.getByLabel(c.fiscalVenue, { exact: true });
    const reserveButton = page.getByRole('button', { name: c.fiscalReserve, exact: true });
    const requests: {venueId:string}[] = [];
    page.on('request', request => { if (request.url().endsWith('/api/account/fiscal-allocations/reserve')) requests.push(request.postDataJSON()); });
    let shownOrganisation: string, shownVenue: string, disabledDuringRead: boolean | undefined;
    let responseStatus: number | null = null;
    if (scenario === 'organisation-loading') {
      let release!: () => void, reached!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const intercepted = new Promise<void>(resolve => { reached = resolve; });
      await page.route('**/api/account/installations', async route => { reached(); await gate; await route.continue(); });
      try {
        await page.evaluate(() => { void (window as any).app.installations.load(); });
        await intercepted;
        disabledDuringRead = await organisation.isDisabled();
        if (!disabledDuringRead) {
          await organisation.selectOption(otherOrganisation);
          // Use the offered venue after the organisation change, with valid fiscal fields.
          await venueSelect.selectOption(venue.venueId);
          await page.waitForFunction(() => !(window as any).app.fiscal.pending);
          await page.evaluate(input => { (window as any).app.fiscal.choose(input); (window as any).app.draw(); }, input);
          const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/account/fiscal-allocations/reserve'));
          await reserveButton.click();
          responseStatus = (await responsePromise).status();
        }
        shownOrganisation = await organisation.inputValue();
        shownVenue = await venueSelect.inputValue();
      } finally { release(); }
      await page.waitForFunction(() => !(window as any).app.installations.pending);
      await page.unroute('**/api/account/installations');
    } else {
      // The live installation list keeps the venue but removes the owner's authority.
      await db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1 AND organisation_id=$2', [owner.accountId, owner.organisationId]);
      await page.evaluate(async () => { await (window as any).app.installations.load(); });
      shownOrganisation = await organisation.inputValue();
      shownVenue = await venueSelect.inputValue();
      if (await reserveButton.count() && await reserveButton.isEnabled()) {
        const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/account/fiscal-allocations/reserve'));
        await reserveButton.click();
        responseStatus = (await responsePromise).status();
      }
    }
    const stored = (await db.pool.query('SELECT a.initial_receipt,v.organisation_id FROM fiscal_registry_allocations a JOIN venues v ON v.id=a.venue_id WHERE a.venue_id=$1', [venue.venueId])).rows;
    const retained = await page.evaluate(() => ({ organisationId: (window as any).app.installations.selectedOrganisation, venueId: (window as any).app.fiscal.venueId ?? null }));
    console.log('FISCAL_STALE_JOURNEY', JSON.stringify({ scenario, shown: { organisationId: shownOrganisation, venueId: shownVenue }, retained, disabledDuringRead, sent: requests, status: responseStatus, stored: stored.map(row => ({ organisationId: row.organisation_id, venueId: row.initial_receipt.payload.venueId })) }));
    if (scenario === 'organisation-loading') {
      assert.equal(disabledDuringRead, true, 'organisation changes must be refused while the list is loading');
      assert.equal(shownOrganisation, owner.organisationId);
      assert.equal(retained.organisationId, shownOrganisation);
    } else {
      assert.equal(shownVenue, '');
      assert.equal(retained.venueId, null, 'an unavailable venue must leave the fiscal draft');
    }
    assert.deepEqual(requests, [], 'no stale venue may be submitted');
    assert.deepEqual(stored, [], 'no stale selection may create a reservation');
    await context.close();
  } finally { await fixture?.close(); await authority.close(); }
});
