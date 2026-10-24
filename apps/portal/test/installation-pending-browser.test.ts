import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium, type Page} from 'playwright';
import {translations} from '../src/locale.ts';

const first = '20000000-0000-4000-8000-000000000001', second = '20000000-0000-4000-8000-000000000002';
const point = '20000000-0000-4000-8000-000000000003', request = '20000000-0000-4000-8000-000000000004';
const installations = [first, second].map(id => ({
  installationId: id, venueId: id, organisationId: id, legalBusinessId: id, environment: 'test', revision: 0,
  revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
  overview: {organisationName: id === first ? 'A first organisation' : 'Z second organisation', businessName: id === first ? 'First test venue' : 'Second test venue', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null},
  services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null})),
}));
const bundle = await build({stdin: {contents: `
  import {applyTokens} from '@waitron-io/ui-core/tokens';
  import {PortalApp} from './src/app.ts';
  applyTokens(document.body);
  window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

async function disabled(page: Page, labels: string[]) {
  for (const label of labels) assert.equal(await page.getByRole('button', {name: label, exact: true}).isDisabled(), true, label);
}

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) test(`${locale} ${theme} ${width}: venue actions wait for installation refresh`, async t => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}}); page.setDefaultTimeout(4000);
    const calls: {path: string; body: unknown}[] = [];
    let gate: Promise<void> | undefined, release: (() => void) | undefined, entered: (() => void) | undefined;
    let refreshed = installations, refreshFails = false;
    await page.route('https://portal.test/recover', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill({json: {accountId: 'owner', expiresAt: new Date(Date.now() + 3600000).toISOString()}});
      if (path.endsWith('/installations')) {entered?.(); await gate; return refreshFails ? route.fulfill({status: 503, json: {error: 'unavailable'}}) : route.fulfill({json: {installations: refreshed}});}
      if (path.endsWith('/usage/read')) return route.fulfill({json: {version: 1, organisationId: route.request().postDataJSON().organisationId, storage: {currentBytes: '0', addedBytes: '0', removedBytes: '0'}, transfer: {uploadedBytes: '0', restoredBytes: '0'}, operations: {installationCompleted: '0', monitoringProbes: '0'}, messages: {sent: '0', failed: '0', expired: '0', cancelled: '0'}, latestEventAt: null, measuredThrough: null}});
      calls.push({path, body: route.request().postData() ? route.request().postDataJSON() : null});
      if (path.endsWith('/backups/list')) return route.fulfill({json: {venueId: route.request().postDataJSON().venueId, points: [{id: point, capturedAt: '2026-10-23T10:00:00.000Z', verification: 'verified', retention: 'daily', expiresAt: '2026-11-23T10:00:00.000Z', protection: 'fallback'}], nextCursor: 'older', defaultPointId: point, continuousRecovery: {recoverableAt: '2026-10-23T10:00:00.000Z', checkedAt: '2026-10-23T10:00:00.000Z', sourceNodeId: second}}});
      if (path.endsWith('/translation-consent')) return route.fulfill({json: {consents: []}});
      if (path.endsWith('/remote-access/status')) return route.fulfill({json: {installationId: second, revision: 0, revoked: false, names: {staff: {assigned: 'staff.example.test', current: 'staff.example.test'}, public: {assigned: 'public.example.test', current: 'public.example.test'}}, service: {state: 'unconfigured', health: 'unknown', observedAt: null, validUntil: null}}});
      return route.fulfill({status: 403, json: {error: 'forbidden'}});
    });
    await page.goto('https://portal.test/recover'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
    await page.waitForFunction(() => (window as any).app.installations.loaded);
    const c = translations[locale];
    const prepare = async (path: '/account' | '/recover') => {
      refreshed = installations; refreshFails = false;
      await page.evaluate(async ({installations, second, request, path}) => {
        const app = (window as any).app;
        app.installations.installations = installations; app.installations.selectOrganisation(second); app.installations.retryAt = 0;
        app.remote.close(); app.backups.close(); app.path = path;
        app.recovery.open(undefined); app.recovery.open(request); app.recovery.code = '12345678';
        app.recovery.view = {requestId: request, state: 'awaiting_owner', expiresAt: new Date(Date.now() + 600000).toISOString(), operationId: null, operation: null};
        if (path === '/account') await app.translationConsent.load();
        app.draw();
      }, {installations, second, request, path});
    };
    const holdRefresh = async () => {
      const received = new Promise<void>(resolve => {entered = resolve;});
      gate = new Promise<void>(resolve => {release = resolve;});
      await page.evaluate(() => {void (window as any).app.installations.load();}); await received;
    };
    const settle = async () => {
      release?.(); gate = undefined; entered = undefined;
      await page.waitForFunction(() => !(window as any).app.installations.pending);
    };
    const screenshot = async (name: string) => {
      if (process.env.INSTALLATION_PENDING_RECEIPT_DIR) {
        await mkdir(process.env.INSTALLATION_PENDING_RECEIPT_DIR, {recursive: true});
        await page.screenshot({path: `${process.env.INSTALLATION_PENDING_RECEIPT_DIR}/${locale}-${theme}-${width}-${name}.png`, fullPage: true});
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    };
    for (const result of ['removed', 'retained', 'failed'] as const) await t.test(`recovery ${result}: selection and approval wait, then reflect the result`, async () => {
      await prepare('/recover');
      await page.getByLabel(c.recoveryVenue, {exact: true}).selectOption(second);
      await page.getByLabel(c.chooseSnapshot, {exact: true}).waitFor();
      await page.getByRole('checkbox', {name: c.recoveryStopped, exact: true}).check();
      await page.getByRole('checkbox', {name: c.recoveryAcceptLoss, exact: true}).check();
      const approve = page.getByRole('button', {name: c.recoveryApprove, exact: true});
      assert.equal(await approve.isEnabled(), true);
      const start = calls.length;
      refreshed = result === 'removed' ? installations.slice(0, 1) : installations; refreshFails = result === 'failed';
      await holdRefresh();
      try {
        const waiting = await approve.isDisabled();
        // A native click exercises the disabled control without Playwright's retry wait.
        await approve.evaluate(button => (button as HTMLButtonElement).click());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const approvals = calls.slice(start).filter(call => call.path.endsWith('/recovery/approve'));
        if (approvals.length) t.diagnostic(JSON.stringify({result, waiting, approvals}));
        assert.equal(waiting, true, 'Approve waits for installations');
        assert.deepEqual(approvals, []);
        assert.equal(await page.getByLabel(c.recoveryVenue, {exact: true}).isDisabled(), true);
        assert.equal(await page.getByLabel(c.recoveryOrganisation, {exact: true}).isDisabled(), true);
        assert.equal(await page.getByLabel(c.chooseSnapshot, {exact: true}).isDisabled(), true);
        assert.equal(await page.getByRole('radio', {name: c.recoveryContinuous, exact: true}).isDisabled(), true);
        assert.equal(await page.getByRole('checkbox', {name: c.recoveryStopped, exact: true}).isDisabled(), true);
        assert.equal(await page.getByRole('checkbox', {name: c.recoveryAcceptLoss, exact: true}).isDisabled(), true);
        await disabled(page, [c.latestSnapshots, c.olderSnapshots]);
        if (result === 'removed') await screenshot('recovery-pending');
      } finally {await settle();}
      assert.equal(await page.getByLabel(c.recoveryVenue, {exact: true}).isEnabled(), true);
      if (result === 'removed') {
        assert.equal(await approve.count(), 0);
        assert.deepEqual(await page.evaluate(() => {const app = (window as any).app; return [app.backups.venueId ?? null, app.recovery.venueId ?? null, app.recovery.stopped, app.recovery.acceptLoss];}), [null, null, false, false]);
      } else {
        assert.equal(await approve.isEnabled(), true);
        assert.equal(await page.getByLabel(c.recoveryVenue, {exact: true}).inputValue(), second);
        assert.equal(await page.getByLabel(c.chooseSnapshot, {exact: true}).isEnabled(), true);
        if (result === 'failed') assert.equal(await page.getByRole('alert').filter({hasText: c.unavailable}).count(), 1);
      }
    });
    for (const expanded of [false, true]) for (const result of ['removed', 'retained'] as const) await t.test(`account ${expanded ? 'open panels' : 'closed panels'} ${result}: per-venue actions wait`, async () => {
      await prepare('/account');
      const article = page.locator('article.installation');
      if (expanded) {
        await article.getByRole('button', {name: c.viewSnapshots, exact: true}).click();
        await article.getByLabel(c.chooseSnapshot, {exact: true}).waitFor();
        await article.getByRole('button', {name: c.remoteSetup, exact: true}).click();
        await article.getByRole('button', {name: c.remoteReview, exact: true}).click();
        await article.getByRole('button', {name: c.remoteConfirm, exact: true}).waitFor();
      }
      assert.equal(await article.getByRole('button', {name: c.translationConsentAgree, exact: true}).isEnabled(), true);
      const start = calls.length;
      refreshed = result === 'removed' ? installations.slice(0, 1) : installations;
      await holdRefresh();
      try {
        await disabled(page, [c.stopAccess, c.diagnosticDownload, c.translationConsentAgree]);
        if (expanded) {
          await disabled(page, [c.latestSnapshots, c.olderSnapshots, c.remoteReview, c.remoteUseAssigned, c.remoteConfirm]);
          assert.equal(await page.getByLabel(c.chooseSnapshot, {exact: true}).isDisabled(), true);
          assert.equal(await page.locator('#remote-kind').isDisabled(), true);
        } else await disabled(page, [c.viewSnapshots, c.remoteSetup]);
        assert.deepEqual(calls.slice(start), []);
        if (expanded && result === 'removed') await screenshot('account-pending');
      } finally {await settle();}
      if (result === 'removed') {
        assert.equal(await article.getByRole('heading', {name: /Second test venue/}).count(), 0);
        assert.deepEqual(await page.evaluate(() => {const app = (window as any).app; return [app.backups.venueId ?? null, app.remote.installationId ?? null];}), [null, null]);
      } else {
        assert.equal(await article.getByRole('button', {name: c.translationConsentAgree, exact: true}).isEnabled(), true);
        assert.equal(await article.getByRole('button', {name: c.diagnosticDownload, exact: true}).isEnabled(), true);
        if (expanded) assert.equal(await article.getByRole('button', {name: c.remoteConfirm, exact: true}).isEnabled(), true);
        else assert.equal(await article.getByRole('button', {name: c.viewSnapshots, exact: true}).isEnabled(), true);
      }
    });
  } finally {await browser.close();}
});
