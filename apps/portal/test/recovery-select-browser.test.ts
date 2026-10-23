import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const first = '20000000-0000-4000-8000-000000000001', second = '20000000-0000-4000-8000-000000000002', production = '20000000-0000-4000-8000-000000000003', point = '20000000-0000-4000-8000-000000000004', request = '20000000-0000-4000-8000-000000000005';
const installations = [first, second, production].map((id, index) => ({
  installationId: id, venueId: id, organisationId: index ? second : first, legalBusinessId: id,
  environment: index === 2 ? 'production' : 'test', revision: 0, revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
  overview: {organisationName: index ? 'Z second organisation' : 'A first organisation', businessName: index === 2 ? 'Production venue' : index ? 'Second test venue' : 'First test venue', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null},
  services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null})),
}));
const bundle = await build({stdin: {contents: `
  import {applyTokens} from '@waitron-io/ui-core/tokens';
  import {PortalApp} from './src/app.ts';
  import {render} from 'lit';
  import {recoveryScreen} from './src/recovery-screen.ts';
  applyTokens(document.body);
  window.app = new PortalApp(document.querySelector('#portal'));
  window.renderRecovery = () => render(recoveryScreen(window.app), document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) test(`${locale} ${theme} ${width}: recovery and account choices agree with their supplied values`, async t => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}}); page.setDefaultTimeout(4000);
    const approvals: unknown[] = [];
    let installationGate: Promise<void> | undefined, releaseInstallations: (() => void) | undefined, installationRead: (() => void) | undefined;
    await page.route('https://portal.test/recover', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill({json: {accountId: 'owner', expiresAt: new Date(Date.now() + 3600000).toISOString()}});
      if (path.endsWith('/installations')) {installationRead?.(); await installationGate; return route.fulfill({json: {installations}});}
      if (path.endsWith('/backups/list')) return route.fulfill({json: {venueId: route.request().postDataJSON().venueId, points: [{id: point, capturedAt: '2026-10-23T10:00:00.000Z', verification: 'verified', retention: 'daily', expiresAt: '2026-11-23T10:00:00.000Z', protection: 'fallback'}], nextCursor: null, defaultPointId: point, continuousRecovery: null}});
      if (path.endsWith('/recovery/approve')) approvals.push(route.request().postDataJSON());
      return route.fulfill({status: 503, json: {error: 'unavailable'}});
    });
    await page.goto('https://portal.test/recover'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    await page.waitForFunction(() => (window as any).app.installations.loaded);
    await page.evaluate(({request, second}) => {
      const app = (window as any).app; app.recovery.open(request); app.recovery.code = '12345678';
      app.recovery.view = {requestId: request, state: 'awaiting_owner', expiresAt: new Date(Date.now() + 600000).toISOString(), operationId: null, operation: null};
      app.installations.selectOrganisation(second); app.draw();
    }, {request, second});
    const c = translations[locale], organisation = page.getByLabel(c.recoveryOrganisation, {exact: true}), venue = page.getByLabel(c.recoveryVenue, {exact: true});
    await t.test('recovery organisation displays the selected second organisation', async () => {
      assert.equal(await organisation.inputValue(), second);
      assert.equal(await organisation.locator('option:checked').textContent(), 'Z second organisation');
    });
    await t.test('a test venue opened on Account stays selected on return', async () => {
      await page.getByRole('link', {name: c.account, exact: true}).click();
      await page.evaluate(async second => {await (window as any).app.backups.open(second);}, second);
      await page.goBack(); await page.getByLabel(c.recoveryVenue, {exact: true}).waitFor();
      assert.equal(await venue.inputValue(), second);
      assert.equal(await venue.locator('option:checked').textContent(), 'Second test venue · ' + second);
      assert.equal(await page.getByLabel(c.chooseSnapshot, {exact: true}).inputValue(), point);
    });
    await t.test('account organisation displays the selected second organisation', async () => {
      await page.getByRole('link', {name: c.account, exact: true}).click();
      const shown = await page.locator('#venue-organisation').inputValue(), name = await page.locator('#venue-organisation option:checked').textContent();
      await page.goBack(); await page.getByLabel(c.recoveryVenue, {exact: true}).waitFor();
      assert.equal(shown, second); assert.equal(name, 'Z second organisation');
    });
    await t.test('refreshing installations disables the organisation choice until the list settles', async () => {
      const entered = new Promise<void>(resolve => {installationRead = resolve;});
      installationGate = new Promise<void>(resolve => {releaseInstallations = resolve;});
      try {
        await page.getByRole('button', {name: c.refreshStatus, exact: true}).click(); await entered;
        assert.equal(await organisation.isDisabled(), true);
        await page.evaluate(first => (window as any).app.installations.selectOrganisation(first), first);
        assert.equal(await organisation.inputValue(), second);
        assert.equal(await page.evaluate(() => (window as any).app.installations.selectedOrganisation), second);
      } finally {releaseInstallations?.(); installationGate = undefined; installationRead = undefined; await page.waitForFunction(() => !(window as any).app.installations.pending);}
      assert.equal(await organisation.isEnabled(), true); assert.equal(await organisation.inputValue(), second);
    });
    await t.test('production backups from Account are cleared before returning to recovery', async () => {
      await page.getByRole('link', {name: c.account, exact: true}).click();
      await page.evaluate(async production => {const app = (window as any).app; await app.backups.open(production); app.recovery.stopped = true; app.recovery.acceptLoss = true;}, production);
      await page.goBack(); await page.getByLabel(c.recoveryVenue, {exact: true}).waitFor();
      assert.equal(await page.getByRole('region', {name: c.recoverySource, exact: true}).count(), 0);
      assert.equal(await page.getByRole('button', {name: c.recoveryApprove, exact: true}).count(), 0);
      assert.deepEqual(await page.evaluate(() => {const app = (window as any).app; return [app.backups.venueId ?? null, app.recovery.venueId ?? null, app.recovery.pointId ?? null, app.recovery.source ?? null, app.recovery.stopped, app.recovery.acceptLoss];}), [null, null, null, null, false, false]);
      assert.deepEqual(approvals, []);
    });
    for (const source of ['snapshot', 'continuous'] as const) await t.test(`the recovery template independently hides an unoffered stale ${source} source`, async () => {
      await page.evaluate(async ({production, source}) => {
        const app = (window as any).app; app.path = '/account'; await app.backups.open(production);
        if (source === 'continuous') {app.backups.page.continuousRecovery = {recoverableAt: '2026-10-23T10:00:00.000Z', checkedAt: '2026-10-23T10:00:00.000Z', sourceNodeId: production}; app.backups.selectContinuous();}
        app.path = '/recover'; (window as any).renderRecovery();
      }, {production, source});
      assert.equal(await page.getByRole('region', {name: c.recoverySource, exact: true}).count(), 0);
      assert.equal(await page.getByRole('checkbox', {name: c.recoveryStopped, exact: true}).count(), 0);
      assert.equal(await page.getByRole('button', {name: c.recoveryApprove, exact: true}).count(), 0);
      await page.evaluate(() => (window as any).app.draw());
    });
    for (const unavailable of ['permission', 'organisation', 'environment', 'removed'] as const) {await t.test(`${unavailable}: recovery clears a test source when its choice disappears`, async () => {
      await page.evaluate(async ({installations, second, first, unavailable}) => {
        const app = (window as any).app; app.installations.installations = installations; app.installations.selectOrganisation(second); await app.backups.open(second);
        app.recovery.stopped = true; app.recovery.acceptLoss = true;
        if (unavailable === 'organisation') app.installations.selectOrganisation(first);
        else {app.installations.installations = installations.flatMap(i => i.venueId !== second ? [i] : unavailable === 'removed' ? [] : [{...i, ...(unavailable === 'permission' ? {canRevoke: false} : {environment: 'production'})}]); app.draw();}
      }, {installations, second, first, unavailable});
      assert.equal(await page.getByRole('button', {name: c.recoveryApprove, exact: true}).count(), 0);
      assert.deepEqual(await page.evaluate(() => {const app = (window as any).app; return [app.backups.venueId ?? null, app.recovery.venueId ?? null, app.recovery.stopped, app.recovery.acceptLoss];}), [null, null, false, false]);
    });
      await page.evaluate(({installations, second}) => {const app = (window as any).app; app.installations.installations = installations; app.installations.selectOrganisation(second);}, {installations, second});
    }
    await t.test('a later offered test venue sends the selected snapshot', async () => {
    await venue.selectOption(second); await page.getByLabel(c.chooseSnapshot, {exact: true}).waitFor();
    assert.equal(await venue.inputValue(), second);
    await page.getByRole('checkbox', {name: c.recoveryStopped, exact: true}).check(); await page.getByRole('checkbox', {name: c.recoveryAcceptLoss, exact: true}).check();
    if (process.env.RECOVERY_PORTAL_RECEIPT_DIR) {await mkdir(process.env.RECOVERY_PORTAL_RECEIPT_DIR, {recursive: true}); await page.screenshot({path: `${process.env.RECOVERY_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-recovery.png`, fullPage: true});}
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', {name: c.recoveryApprove, exact: true}).click(); await page.waitForFunction(() => !(window as any).app.recovery.pending);
    assert.deepEqual(approvals, [{requestId: request, code: '12345678', source: 'snapshot', pointId: point, oldServerUnavailable: 'true', acceptDataLoss: 'true'}]);
    });
    await t.test('pairing keeps a supplied second business selected, including redraw and edits', async () => {
      await page.evaluate(({first, second, request}) => {
        const app = (window as any).app, p = app.pairing; p.open(request); p.loaded = true; p.code = '12345678'; p.selected = second;
        p.businesses = [first, second].map(id => ({organisationId: id, legalBusinessId: id, organisationName: id === first ? 'A first organisation' : 'Z second organisation', legalBusinessName: id === first ? 'First test venue' : 'Second test venue', countryCode: 'ES'}));
        p.view = {requestId: request, state: 'awaiting_cloud', localVenueId: second, environment: 'test'}; app.path = '/connect'; app.draw();
      }, {first, second, request});
      const business = page.locator('select[name=legalBusinessId]'); assert.equal(await business.inputValue(), second);
      await page.evaluate(() => (window as any).app.draw()); assert.equal(await business.inputValue(), second);
      await business.selectOption(first); assert.equal(await business.inputValue(), first); assert.equal(await page.evaluate(() => (window as any).app.pairing.selected), first);
    });
  } finally {await browser.close();}
});
