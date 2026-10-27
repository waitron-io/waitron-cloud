import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile, mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium, type Page} from 'playwright';
import {reserve} from '../../../packages/fiscal-allocation/test/fixtures.ts';
import {translations} from '../src/locale.ts';

const input = reserve();
const installation = {
  installationId: '20000000-0000-4000-8000-000000000001', venueId: input.venueId,
  organisationId: '20000000-0000-4000-8000-000000000002', legalBusinessId: '20000000-0000-4000-8000-000000000003',
  environment: 'test', revision: 0, revokedAt: null, lastContactAt: null, leaseExpiresAt: null, canRevoke: true,
  overview: {organisationName: 'Restaurantes Pepe SL', businessName: 'Bar Pepe', countryCode: 'ES', latestSnapshotAt: null, verifiedSnapshotAt: null},
  services: ['continuous_backup', 'remote_access', 'retained_snapshots'].map(service => ({service, state: 'unconfigured', health: 'unknown', failure: null, observedAt: null})),
};
const bundle = await build({stdin: {contents: `
  import {applyTokens} from '@waitron-io/ui-core/tokens';
  import {PortalApp} from './src/app.ts';
  applyTokens(document.body);
  window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

async function fixture(page: Page, initialStatus = 503, handler: 'normal' | 'delayed' | 'missing' = 'normal') {
  page.setDefaultTimeout(2000);
  let status = initialStatus, reads = 0;
  let releaseRead: (() => void) | undefined, readGate: Promise<void> | undefined;
  let releaseWrite: (() => void) | undefined, writeGate: Promise<void> | undefined;
  const writes: unknown[] = [];
  await page.route('https://portal.test/fiscal-allocations', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
  await page.route('**/api/account/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill({json: {accountId: 'owner', expiresAt: new Date(Date.now() + 3600000).toISOString()}});
    if (path.endsWith('/installations')) {
      if (readGate && handler === 'delayed') await delay(250);
      if (!readGate || handler !== 'missing') reads++;
      await readGate;
      return status === 200 ? route.fulfill({json: {installations: [installation]}})
        : route.fulfill({status, headers: status === 429 ? {'Retry-After': '2'} : {}, json: {error: status === 429 ? 'rate_limited' : 'unavailable'}});
    }
    if (path.endsWith('/reserve')) {writes.push(route.request().postDataJSON()); await writeGate; return route.abort();}
    if (path.endsWith('/fiscal-allocations/list')) return route.fulfill({json: {items: [], nextCursor: null}});
    return route.fulfill({status: 503, json: {error: 'unavailable'}});
  });
  await page.goto('https://portal.test/fiscal-allocations');
  await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
  await page.waitForFunction(() => (window as any).app.installations.loaded);
  return {
    get reads() {return reads;}, writes,
    status(value: number) {status = value;},
    holdRead() {readGate = new Promise<void>(resolve => {releaseRead = resolve;});},
    releaseRead() {releaseRead?.(); readGate = undefined;},
    holdWrite() {writeGate = new Promise<void>(resolve => {releaseWrite = resolve;});},
    releaseWrite() {releaseWrite?.(); writeGate = undefined;},
  };
}

for (const handler of ['normal', 'delayed', 'missing'] as const)
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  if (handler === 'missing' && (locale !== 'en' || theme !== 'light' || width !== 390)) continue;
  test(`${locale} ${theme} ${width}${handler === 'normal' ? '' : ` with ${handler} refresh handler`}: a failed venue list explains itself and can be retried`, async t => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      const f = await fixture(page, 503, handler), c = translations[locale];
      // Browser pending state can precede the Node route handler's read count.
      const waitForRefreshHandler = () => t.waitFor(() => {
        assert.equal(f.reads, 2);
      }, {timeout: 2000});
      const refresh = page.getByRole('button', {name: c.refreshStatus, exact: true});
      const venue = page.getByLabel(c.fiscalVenue, {exact: true});
      await t.test('the failed read shows its alert beside an available refresh action', async () => {
        assert.deepEqual(await page.getByRole('alert').allTextContents(), [c.unavailable]);
        assert.equal(await refresh.count(), 1);
        assert.equal(await refresh.isEnabled(), true);
        assert.deepEqual(await venue.locator('option').allTextContents(), [c.recoveryChooseVenue]);
        assert.equal(f.reads, 1); assert.deepEqual(f.writes, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.FISCAL_PORTAL_RECEIPT_DIR) {
          await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR, {recursive: true});
          await page.screenshot({path: `${process.env.FISCAL_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-read-failed.png`, fullPage: true});
        }
      });
      if (handler === 'missing') {
        f.status(200); f.holdRead();
        try {
          await refresh.click();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await assert.rejects(Promise.race([waitForRefreshHandler(), new Promise<void>(resolve => {timer = setTimeout(resolve, 3000);})]), /waitFor\(\) timed out/);
          } finally {clearTimeout(timer);}
        } finally {f.releaseRead();}
        return;
      }
      await t.test('refresh waits for the list, then shows the recovered venue without a fiscal write', async () => {
        f.status(200); f.holdRead();
        try {
          await refresh.click(); await page.waitForFunction(() => (window as any).app.installations.pending);
          await waitForRefreshHandler();
          assert.equal(await venue.isDisabled(), true);
          assert.equal(await page.getByRole('alert').count(), 0);
          assert.equal(await refresh.isDisabled(), true);
          await refresh.evaluate(button => (button as HTMLButtonElement).click());
          assert.equal(f.reads, 2); assert.deepEqual(f.writes, []);
        } finally {f.releaseRead();}
        await page.waitForFunction(() => !(window as any).app.installations.pending);
        assert.equal(await venue.isEnabled(), true);
        assert.deepEqual(await venue.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ['', input.venueId]);
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal(await refresh.isEnabled(), true);
        assert.equal(f.reads, 2); assert.deepEqual(f.writes, []);
      });
    } finally {await browser.close();}
  });
}

for (const locale of ['en', 'es'] as const) {
  test(`${locale}: venue refresh respects Retry-After and becomes available when the wait ends`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, viewport: {width: 390, height: 900}});
      await page.clock.install();
      const f = await fixture(page, 429), c = translations[locale];
      const refresh = page.getByRole('button', {name: c.refreshStatus, exact: true});
      assert.deepEqual(await page.getByRole('alert').allTextContents(), [c.limited]);
      assert.equal(await refresh.isDisabled(), true);
      await refresh.evaluate(button => (button as HTMLButtonElement).click());
      assert.equal(f.reads, 1);
      f.status(200); await page.clock.fastForward(2100);
      await page.waitForFunction(() => !(window as any).app.waiting);
      assert.equal(await refresh.isEnabled(), true);
      await refresh.click(); await page.waitForFunction(() => !(window as any).app.installations.pending);
      assert.equal(f.reads, 2); assert.deepEqual(f.writes, []);
    } finally {await browser.close();}
  });

  test(`${locale}: pending and uncertain fiscal writes disable venue refresh and keep their evidence`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, viewport: {width: 390, height: 900}});
      const f = await fixture(page, 200), c = translations[locale];
      await page.getByLabel(c.fiscalVenue, {exact: true}).selectOption(input.venueId);
      await page.waitForFunction(() => !(window as any).app.fiscal.pending);
      await page.evaluate(input => {const app = (window as any).app; app.fiscal.choose(input); app.draw();}, input);
      f.holdWrite();
      try {
        await page.getByRole('button', {name: c.fiscalReserve, exact: true}).click();
        await page.waitForFunction(() => (window as any).app.fiscal.pending);
        f.status(503);
        await page.evaluate(async () => {await (window as any).app.installations.load();});
        const refresh = page.getByRole('button', {name: c.refreshStatus, exact: true});
        assert.equal(await refresh.isDisabled(), true);
        await refresh.evaluate(button => (button as HTMLButtonElement).click());
        assert.equal(f.reads, 2);
        assert.deepEqual(await page.evaluate(() => (window as any).app.fiscal.pendingRequest?.input), input);
      } finally {f.releaseWrite();}
      await page.waitForFunction(() => !(window as any).app.fiscal.pending);
      assert.equal(await page.evaluate(() => (window as any).app.fiscal.uncertain), true);
      const refresh = page.getByRole('button', {name: c.refreshStatus, exact: true});
      assert.equal(await refresh.isDisabled(), true);
      await refresh.evaluate(button => (button as HTMLButtonElement).click());
      assert.equal(f.reads, 2); assert.deepEqual(f.writes, [input]);
      assert.deepEqual(await page.evaluate(() => (window as any).app.fiscal.pendingRequest?.input), input);
      assert.equal(await page.getByRole('button', {name: c.fiscalReconcile, exact: true}).isEnabled(), true);
    } finally {await browser.close();}
  });
}
