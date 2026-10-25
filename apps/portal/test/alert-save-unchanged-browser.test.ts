import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const bundle = await build({stdin: {contents: `
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: alert Save waits for a changed choice and a confirmed save disables it again`, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      const c = translations[locale], other = locale === 'en' ? 'es' : 'en';
      const writes: unknown[] = [];
      let uncertain = false;
      await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html',
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
      await page.route('**/api/account/**', route => {
        const path = new URL(route.request().url()).pathname.replace('/api/account', '');
        if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
        if (path === '/passkeys') return route.fulfill({json: {passkeys: []}});
        if (path === '/sessions') return route.fulfill({json: {sessions: []}});
        if (path === '/installations') return route.fulfill({json: {installations: []}});
        if (path === '/authenticator') return route.fulfill({json: {active: false, version: 0, recoveryCodesRemaining: 0, available: false}});
        if (path === '/translation-consent') return route.fulfill({json: {consents: []}});
        if (path === '/alerts') {
          if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON() as {enabled: string; locale: string};
            writes.push(body);
            if (uncertain) return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
            return route.fulfill({json: {enabled: body.enabled === 'on', locale: body.locale}});
          }
          return route.fulfill({json: {enabled: true, locale}});
        }
        return route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
      });
      await page.goto('https://portal.test/account');
      await page.addStyleTag({content: styles});
      await page.addScriptTag({content: bundle.outputFiles[0]!.text});
      const checkbox = page.getByRole('checkbox', {name: c.alertsReceive, exact: true});
      const language = page.getByLabel(c.alertsLanguage, {exact: true});
      const save = page.getByRole('button', {name: c.alertsSave, exact: true});
      await checkbox.waitFor();
      assert.equal(await checkbox.isChecked(), true);
      assert.equal(await language.inputValue(), locale);
      assert.equal(await save.isEnabled(), false, 'the loaded choices need no save');
      await save.evaluate(button => (button as HTMLButtonElement).click());
      assert.equal(writes.length, 0);
      assert.equal(await page.getByText(c.alertsSaved, {exact: true}).count(), 0);
      await checkbox.uncheck();
      assert.equal(await save.isEnabled(), true, 'changing the checkbox enables Save immediately');
      await checkbox.check();
      assert.equal(await save.isEnabled(), false, 'reverting the checkbox needs no save');
      await language.selectOption(other);
      assert.equal(await save.isEnabled(), true, 'changing the email language enables Save');
      await language.selectOption(locale);
      assert.equal(await save.isEnabled(), false, 'reverting the email language needs no save');
      await checkbox.uncheck();
      await language.selectOption(other);
      await save.click();
      await page.getByText(c.alertsSaved, {exact: true}).waitFor();
      assert.deepEqual(writes, [{enabled: 'off', locale: other}]);
      assert.equal(await save.isEnabled(), false, 'the server confirmed both choices');
      await save.evaluate(button => (button as HTMLButtonElement).click());
      assert.equal(writes.length, 1);
      assert.equal(await checkbox.isChecked(), false);
      assert.equal(await language.inputValue(), other);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.ALERT_SAVE_RECEIPT_DIR) {
        await mkdir(process.env.ALERT_SAVE_RECEIPT_DIR, {recursive: true});
        await checkbox.scrollIntoViewIfNeeded();
        await page.screenshot({path: `${process.env.ALERT_SAVE_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});
      }
      await checkbox.check();
      uncertain = true;
      await save.click();
      await page.getByRole('alert').filter({hasText: c.alertsUncertain}).waitFor();
      assert.equal(await save.isEnabled(), true, 'an unconfirmed save remains retryable');
      await checkbox.uncheck();
      assert.equal(await save.isEnabled(), true, 'reverting cannot confirm an unknown server outcome');
      uncertain = false;
      await save.click();
      await page.getByText(c.alertsSaved, {exact: true}).waitFor();
      assert.deepEqual(writes, [
        {enabled: 'off', locale: other}, {enabled: 'on', locale: other}, {enabled: 'off', locale: other},
      ]);
      assert.equal(await save.isEnabled(), false, 'a confirmed retry restores the unchanged state');
    } finally { await browser.close(); }
  });
}
