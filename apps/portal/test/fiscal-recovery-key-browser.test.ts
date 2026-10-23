import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { SignupStore, RegistrationStore } from '@waitron-cloud/registration';
import { createSession } from '@waitron-cloud/identity';
import { transaction } from '../../../packages/registration/src/transaction.ts';
import { authorityFixture } from '../../../packages/fiscal-allocation/test/continuity-fixture.ts';
import { testOptions } from '../../../packages/fiscal-allocation/test/store-fixture.ts';
import { FiscalAllocationStore } from '../../../packages/fiscal-allocation/src/store.ts';
import { key, bases, reserve } from '../../../packages/fiscal-allocation/test/fixtures.ts';
import { encodeReceipt } from '../../../packages/fiscal-allocation/src/evidence.ts';
import { startPortalFixture } from './fixtures.ts';
import { translations } from '../src/locale.ts';

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) test(`${locale} ${theme} ${width}: retained key-event receipt displays attribution and preserves its packet`, async () => {
  const a = await authorityFixture();
  let f: Awaited<ReturnType<typeof startPortalFixture>> | undefined;
  try {
    const options = testOptions(a.adapter());
    f = await startPortalFixture(undefined, undefined, undefined, options);
    const db = f.db.pool, signup = new SignupStore(db, f.db.outbox);
    await signup.request('key-recovery@example.test');
    const mail = f.db.outbox.open((await db.query('SELECT * FROM email_outbox')).rows[0]); assert('token' in mail);
    const owner = await signup.complete(mail.token, { password: 'A long synthetic owner password', organisationName: 'Café Sol', legalBusinessName: 'Sol SL', countryCode: 'ES' });
    const registration = new RegistrationStore(db), request = { operationId: randomUUID(), installationKey: key().publicKey, localVenueId: randomUUID(), environment: 'test' as const, organisationId: owner.organisationId, legalBusinessId: owner.legalBusinessId };
    await registration.start(request); await registration.approveCloud(request, owner.accountId); await registration.approveLocal(request, randomUUID()); const venue = await registration.complete(request);
    await db.query('CREATE TABLE fiscal_test_authority(account_id uuid PRIMARY KEY, entitlement boolean NOT NULL DEFAULT true, custody boolean NOT NULL DEFAULT true, operator_verified boolean NOT NULL DEFAULT true, bases jsonb NOT NULL)');
    await db.query('INSERT INTO fiscal_test_authority(account_id,bases) VALUES($1,$2)', [owner.accountId, JSON.stringify(bases)]);
    const session = await transaction(db, c => createSession(c, owner.accountId));
    const binding = { ...reserve().binding, eventId: 'restore-event', targetNodeId: 'replacement-node', operatorId: { kind: 'recovery-key' as const, nodeId: 'replacement-node', eventId: 'restore-event' } };
    const store = new FiscalAllocationStore(db, options), reserved = await store.reserve(session.token, session.csrfToken, { ...reserve(), operationId: randomUUID(), venueId: venue.venueId, binding });
    const consumed = await store.consume(session.token, session.csrfToken, { version: 1, operationId: randomUUID(), allocationId: reserved.payload.allocation.allocationId, binding, oldMachineOffline: true, oldMachineAbsent: false, noParallelRecovery: true, confirmedAt: new Date().toISOString() });
    const context = await f.browser.newContext({ locale, colorScheme: theme, viewport: { width, height: 900 } }), page = await context.newPage();
    await context.addCookies([{ name: 'cloud_session', value: session.token, url: f.origin, httpOnly: true }, { name: 'cloud_csrf', value: session.csrfToken, url: f.origin }]);
    await page.goto(f.origin + '/fiscal-allocations');
    const c = translations[locale];
    await page.getByLabel(c.fiscalVenue, { exact: true }).selectOption(venue.venueId);
    await page.getByRole('button', { name: c.fiscalInspect, exact: true }).click();
    const attribution = locale === 'en' ? 'Recovery key · replacement-node · restore-event' : 'Clave de recuperación · replacement-node · restore-event';
    await page.getByText(attribution, { exact: true }).first().waitFor({ timeout: 4000 });
    for (const [index, purpose] of ['standard', 'full', 'rectificative'].entries()) {
      const selector = page.getByLabel(c.fiscalPurpose + ' ' + (index + 1), { exact: true });
      assert.equal(await selector.isDisabled(), true);
      assert.equal(await selector.inputValue(), purpose);
      assert.equal(await selector.locator('option:checked').textContent(), [c.fiscalStandard, c.fiscalFull, c.fiscalRectificative][index]);
    }
    assert.equal(await page.getByLabel(c.fiscalPacket, { exact: true }).inputValue(), encodeReceipt(consumed));
    assert(!(await page.locator('body').innerText()).includes('[object Object]'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.FISCAL_PORTAL_RECEIPT_DIR) { await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR, { recursive: true }); await page.screenshot({ path: process.env.FISCAL_PORTAL_RECEIPT_DIR + `/${locale}-${theme}-${width}-key.png`, fullPage: true }); }
    await context.close();
  } finally { await f?.close(); await a.close(); }
});
