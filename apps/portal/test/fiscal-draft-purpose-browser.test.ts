import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { payload, key, binding, date } from '../../../packages/fiscal-allocation/test/fixtures.ts';
import { signReceipt, encodeReceipt } from '../../../packages/fiscal-allocation/src/evidence.ts';
import { translations } from '../src/locale.ts';

const receipt = signReceipt({ ...payload(), state: 'consumed', approval: {
  version: 1, ...binding, oldMachineOffline: true, oldMachineAbsent: false,
  noParallelRecovery: true, confirmedAt: date,
} }, key());
const bundle = await build({ stdin: { contents: `
  import { render } from 'lit';
  import { applyTokens } from '@waitron-io/ui-core/tokens';
  import '@waitron-io/ui-core/components/wt-input';
  import '@waitron-io/ui-core/components/wt-button';
  import { fiscalAllocationScreen } from './src/fiscal-allocation-screen.ts';
  import { FiscalAllocationController } from './src/fiscal-allocation-controller.ts';
  import { translations } from './src/locale.ts';
  applyTokens(document.body);
  window.mount = (locale, receipt) => {
    const app = { copy: translations[locale], session: { state: { kind: 'authenticated' } },
      installations: { organisations: [], visible: [{ venueId: receipt.payload.venueId, canRevoke: true, overview: { businessName: 'Café Sol' }, environment: 'test' }] },
      draw() { render(fiscalAllocationScreen(app), document.querySelector('#portal')); } };
    app.fiscal = new FiscalAllocationController(() => app.draw());
    app.fiscal.account(receipt.payload.cloudAccountId);
    app.draw();
    app.fiscal.open(receipt.payload.venueId);
    app.fiscal.inspect(receipt);
    window.fiscal = app.fiscal;
    window.redraw = () => app.draw();
  };
`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'iife', target: 'es2023' });
const script = bundle.outputFiles[0]!.text;
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: retained draft shows each signed purpose on first render and keeps edits`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ locale, colorScheme: theme, viewport: { width, height: 900 } });
      await page.route('https://portal.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="portal" class="portal"></div>' }));
      await page.goto('https://portal.test/');
      await page.addStyleTag({ content: styles });
      await page.addScriptTag({ content: script });
      await page.evaluate(({ locale, receipt }) => (window as any).mount(locale, receipt), { locale, receipt });
      const c = translations[locale];
      for (const [index, purpose] of ['standard', 'full', 'rectificative'].entries()) {
        const selector = page.getByLabel(c.fiscalPurpose + ' ' + (index + 1), { exact: true });
        assert.equal(await selector.isDisabled(), true);
        assert.equal(await selector.inputValue(), purpose);
        assert.equal(await selector.locator('option:checked').textContent(), [c.fiscalStandard, c.fiscalFull, c.fiscalRectificative][index]);
      }
      assert.equal(await page.getByLabel(c.fiscalPacket, { exact: true }).inputValue(), encodeReceipt(receipt));
      assert.deepEqual(await page.evaluate(() => (window as any).fiscal.receipt), receipt);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.FISCAL_PORTAL_RECEIPT_DIR) {
        await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR, { recursive: true });
        await page.screenshot({ path: `${process.env.FISCAL_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-draft.png`, fullPage: true });
      }
      await page.getByRole('button', { name: c.fiscalNew, exact: true }).click();
      const second = page.getByLabel(c.fiscalPurpose + ' 2', { exact: true });
      assert.equal(await second.isDisabled(), false);
      await second.selectOption('rectificative');
      await page.evaluate(() => (window as any).redraw());
      assert.equal(await second.inputValue(), 'rectificative');
      assert.equal(await page.evaluate(() => (window as any).fiscal.selection.bases[1].purpose), 'rectificative');
      assert.equal(receipt.payload.allocation.series[1]!.purpose, 'full');
    } finally { await browser.close(); }
  });
}

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  for (const [kind, nif, software] of [
    ['lowercase', 'b12345678', 'ab'],
    ['padded', ' B12345678 ', ' AB '],
  ] as const) {
    test(`${locale} ${theme} ${width}: ${kind} fiscal identifiers are normalised before reserve`, async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ locale, colorScheme: theme, viewport: { width, height: 900 } });
        const requests: unknown[] = [];
        await page.route('https://portal.test/api/account/fiscal-allocations/reserve', async route => {
          requests.push(route.request().postDataJSON());
          await route.fulfill({ status: 400, json: { error: 'invalid_input' } });
        });
        await page.route('https://portal.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="portal" class="portal"></div>' }));
        await page.goto('https://portal.test/');
        await page.addStyleTag({ content: styles });
        await page.addScriptTag({ content: script });
        await page.evaluate(({ locale, receipt }) => (window as any).mount(locale, receipt), { locale, receipt });
        const c = translations[locale];
        await page.getByRole('button', { name: c.fiscalNew, exact: true }).click();
        const nifField = page.locator('wt-input[name=fiscalNif]');
        const softwareField = page.locator('wt-input[name=fiscalSoftware]');
        await nifField.locator('input').fill('');
        await nifField.locator('input').focus();
        await page.keyboard.insertText(nif);
        await softwareField.locator('input').fill('');
        await softwareField.locator('input').focus();
        await page.keyboard.insertText(software);
        assert.equal(await nifField.locator('input').inputValue(), nif);
        assert.equal(await softwareField.locator('input').inputValue(), software);
        const before = await page.evaluate(() => structuredClone((window as any).fiscal.selection));
        await page.getByRole('button', { name: c.fiscalReserve, exact: true }).click();
        await page.waitForFunction(() => !(window as any).fiscal.pending);
        assert.equal(requests.length, 1, 'a valid normalised draft must reach the reserve endpoint');
        assert.deepEqual(requests[0], { ...before, scope: {
          taxpayerNif: 'B12345678', softwareId: 'AB', environment: 'preproduction',
        } });
        assert.deepEqual(await page.evaluate(() => [...(window as any).fiscal.fieldErrors]), []);
        assert.equal(await nifField.locator('input').inputValue(), 'B12345678');
        assert.equal(await softwareField.locator('input').inputValue(), 'AB');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.FISCAL_PORTAL_RECEIPT_DIR && kind === 'lowercase') {
          await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR, { recursive: true });
          await page.screenshot({ path: `${process.env.FISCAL_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-normalised.png`, fullPage: true });
        }
      } finally { await browser.close(); }
    });
  }
}

test('malformed fiscal identifiers send no reserve request', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const requests: unknown[] = [];
    await page.route('https://portal.test/api/account/fiscal-allocations/reserve', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 400, json: { error: 'invalid_input' } });
    });
    await page.route('https://portal.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="portal" class="portal"></div>' }));
    await page.goto('https://portal.test/');
    await page.addScriptTag({ content: script });
    await page.evaluate(receipt => (window as any).mount('en', receipt), receipt);
    const c = translations.en;
    await page.getByRole('button', { name: c.fiscalNew, exact: true }).click();
    const nif = page.locator('wt-input[name=fiscalNif] input');
    const software = page.locator('wt-input[name=fiscalSoftware] input');
    for (const [nifValue, softwareValue, errors] of [
      ['B123 5678', 'AB', ['fiscalNif']],
      ['B1234567!', 'AB', ['fiscalNif']],
      ['B1234567', 'AB', ['fiscalNif']],
      ['B123456789', 'AB', ['fiscalNif']],
      ['   ', 'AB', ['fiscalNif']],
      ['B12345678', 'A!', ['fiscalSoftware']],
      ['B12345678', 'A ', ['fiscalSoftware']],
      ['B12345678', 'ABC', ['fiscalSoftware']],
    ] as const) {
      await nif.fill(nifValue);
      await software.fill(softwareValue);
      await page.getByRole('button', { name: c.fiscalReserve, exact: true }).click();
      assert.deepEqual(await page.evaluate(() => [...(window as any).fiscal.fieldErrors]), errors);
      assert.equal(requests.length, 0);
    }
  } finally { await browser.close(); }
});
