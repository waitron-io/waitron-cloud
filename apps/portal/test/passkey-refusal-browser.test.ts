import assert from 'node:assert/strict';
import {mkdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';
const bundle = await build({stdin: {contents: `import {applyTokens} from '@waitron-io/ui-core/tokens'; import {PortalApp} from './src/app.ts'; applyTokens(document.body); window.passkeyRefusalApp = new PortalApp(document.querySelector('#portal'));`, resolveDir: new URL('..', import.meta.url).pathname}, bundle: true, write: false, format: 'iife', target: 'es2023'});
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const id = '12345678-1234-4234-8234-123456789abc', addedId = '22345678-1234-4234-8234-123456789abc';
const key = {id, createdAt: '2026-09-26T00:00:00.000Z', lastUsedAt: null};
const labels = {
  en: {check: 'Check passkeys', registration: 'Check your passkeys. To add one, enter your password and start a new prompt. Choose another passkey if it is already registered. Password sign-in remains available.', removal: 'Check your passkeys. If this key is still listed, enter your password and remove it again. Password sign-in remains available.'},
  es: {check: 'Comprobar llaves de acceso', registration: 'Comprueba tus llaves de acceso. Para añadir una, introduce tu contraseña e inicia una nueva solicitud. Elige otra llave si ya está registrada. Puedes seguir entrando con tu contraseña.', removal: 'Comprueba tus llaves de acceso. Si esta llave sigue en la lista, introduce tu contraseña y elimínala de nuevo. Puedes seguir entrando con tu contraseña.'},
};
for (const locale of ['en', 'es'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [390, 1280]) {
  test(`${locale} ${theme} ${width}: refused passkey changes have a read-only check and fresh attempt`, async t => {
    const browser = await chromium.launch({headless: true});
    const flows = ['options', 'verify', 'remove', 'browser-duplicate', 'failed-list', 'navigation', ...(locale === 'en' && theme === 'light' && width === 390 ? ['missing-handler'] as const : [])] as const;
    try { for (const flow of flows) await t.test(flow, async () => {
      const page = await browser.newPage({locale, colorScheme: theme, viewport: {width, height: 900}});
      page.setDefaultTimeout(4000);
      let release!: () => void;
      const checked = new Promise<void>(resolve => {release = resolve;});
      let checking = false, refused = false, refusingAgain = false, reads = 0, added = false, removed = false, optionsCount = 0;
      const writes: {path: string; body: Record<string, unknown>}[] = [];
      const c = translations[locale], text = labels[locale];
      const failureAt = flow === 'failed-list' || flow === 'navigation' || flow === 'missing-handler' ? 'verify' : flow;
      try {
        const virtual = await page.context().newCDPSession(page);
        await virtual.send('WebAuthn.enable');
        await virtual.send('WebAuthn.addVirtualAuthenticator', {options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
        if (flow === 'browser-duplicate') await page.addInitScript(() => {
          const create = navigator.credentials.create.bind(navigator.credentials); let refused = false;
          navigator.credentials.create = async options => {
            if (!refused) {refused = true; throw new DOMException('Already registered', 'InvalidStateError');}
            return create(options);
          };
        });
        await page.route('https://portal.test/account', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
        await page.route('**/api/account/**', async route => {
          const req = route.request(), path = new URL(req.url()).pathname.replace('/api/account', '');
          if (path === '/session' || path === '/session/activity') return route.fulfill({json: {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z'}});
          if (path === '/passkeys') {reads++; if (checking) await checked; if (flow === 'failed-list' && refused && !checking) return route.fulfill({status: 503, json: {error: 'unavailable'}}); return route.fulfill({json: {passkeys: removed ? [] : added ? [key, {...key, id: addedId}] : [key]}});}
          if (path.startsWith('/passkeys/')) {
            writes.push({path, body: req.postDataJSON()});
            if (refusingAgain || (flow !== 'browser-duplicate' && !refused && path.endsWith(failureAt === 'options' ? '/options' : failureAt === 'verify' ? '/verify' : '/remove'))) {refused = true; return route.fulfill({status: 400, headers: refusingAgain ? {'Retry-After': '60'} : {}, json: {error: 'invalid_input'}});}
            if (path.endsWith('/options')) {
              optionsCount++;
              return route.fulfill({json: {ceremonyId: optionsCount === 1 ? id : addedId, options: {challenge: optionsCount === 1 ? 'YWJj' : 'ZGVm', rp: {name: 'Waitron Cloud', id: 'portal.test'}, user: {id: 'b3duZXI', name: 'owner@example.test', displayName: 'Owner'}, pubKeyCredParams: [{type: 'public-key', alg: -7}]}}});
            }
            if (path.endsWith('/verify')) {added = true; return route.fulfill({status: 201, json: {...key, id: addedId}});}
            if (path.endsWith('/remove')) {removed = true; return route.fulfill({status: 204});}
          }
          if (path === '/installations') return route.fulfill({json: {installations: []}});
          return route.fulfill({status: 503, json: {error: 'unavailable'}});
        });
        await page.goto('https://portal.test/account'); await page.addStyleTag({content: styles}); await page.addScriptTag({content: bundle.outputFiles[0]!.text});
        const section = page.locator('.passkeys'), password = section.locator('input[name=passkeyPassword]');
        const action = section.getByRole('button', {name: flow === 'remove' ? c.passkeyRemove : c.passkeyAdd, exact: true}).first();
        await section.locator('.passkey-list li').waitFor();
        await password.fill('Old password'); await action.click();
        await section.getByRole('alert').getByText(flow === 'remove' ? text.removal : text.registration, {exact: true}).waitFor();
        assert.equal(await section.getByText(c.passkeyUnavailable, {exact: true}).count(), 0);
        assert.equal(await section.getByRole('alert').count(), 1);
        assert.equal(await section.getByRole('button', {name: c.retry, exact: true}).count(), 0, 'one list-check action even if the automatic read failed');
        assert.equal(await section.getByText(c.passkeyNone, {exact: true}).count(), 0);
        const refresh = section.getByRole('button', {name: text.check, exact: true});
        assert.equal(await refresh.isEnabled(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.PASSKEY_REFUSAL_RECEIPT_DIR && flow === 'verify') {await mkdir(process.env.PASSKEY_REFUSAL_RECEIPT_DIR, {recursive: true}); await section.screenshot({path: `${process.env.PASSKEY_REFUSAL_RECEIPT_DIR}/${locale}-${theme}-${width}.png`});}
        const before = writes.length, beforeReads = reads; checking = true;
        if (flow === 'navigation') await page.evaluate(() => {
          const w = window as unknown as {passkeyRefusalApp: {refreshPasskeys(): Promise<void>}; passkeyRefreshDone: Promise<void>};
          const original = w.passkeyRefusalApp.refreshPasskeys.bind(w.passkeyRefusalApp);
          w.passkeyRefusalApp.refreshPasskeys = () => w.passkeyRefreshDone = original();
        });
        if (flow === 'missing-handler') await page.route('**/api/account/passkeys', route => route.fulfill({json: {passkeys: [key]}}));
        const requested = page.waitForRequest('**/api/account/passkeys'); await refresh.click(); await requested;
        // The request event can precede the route handler that counts and holds the read.
        const waitForHandler = () => t.waitFor(() => {
          assert.equal(reads, beforeReads + 1, 'the passkey refresh route handler must count the read');
        }, {timeout: 4000});
        if (flow === 'missing-handler') {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await assert.rejects(Promise.race([
              waitForHandler(),
              new Promise<void>(resolve => {timer = setTimeout(resolve, 5000);}),
            ]), /waitFor\(\) timed out/);
          } finally {clearTimeout(timer);}
          return;
        }
        await waitForHandler();
        assert.equal(writes.length, before, 'checking never repeats registration or removal'); assert.equal(reads, beforeReads + 1);
        assert.equal(await password.inputValue(), ''); assert.equal(await password.isDisabled(), true, 'the check keeps password entry disabled while pending');
        if (flow === 'navigation') {
          await page.evaluate(() => (window as unknown as {passkeyRefusalApp: {navigate(path: string): void}}).passkeyRefusalApp.navigate('/login'));
          const email = page.locator('input[name=email]'); await email.focus(); release();
          await page.evaluate(() => (window as unknown as {passkeyRefreshDone: Promise<void>}).passkeyRefreshDone);
          assert.equal(await email.evaluate(el => el === (el.getRootNode() as ShadowRoot).activeElement), true, 'an old refresh cannot steal focus on the new page');
          return;
        }
        release();
        await page.waitForFunction(() => document.querySelector('h1') === document.activeElement);
        assert.equal(await section.getByRole('alert').count(), 0); assert.equal(await refresh.count(), 0);
        if (flow === 'remove') {
          await action.click(); await section.getByRole('alert').getByText(c.requiredPassword, {exact: true}).waitFor();
          assert.equal(writes.length, before, 'removal needs a fresh password');
        } else assert.equal(await action.isDisabled(), true, 'another registration needs a fresh password');
        await password.fill('Fresh password'); await action.click();
        await section.getByRole('status').getByText(flow === 'remove' ? c.passkeyRemoved : c.passkeyAdded, {exact: true}).waitFor();
        const change = writes.slice(before);
        if (flow === 'remove') assert.deepEqual(change, [{path: '/passkeys/remove', body: {id, password: 'Fresh password'}}]);
        else {
          assert.deepEqual(change.map(x => x.path), ['/passkeys/registration/options', '/passkeys/registration/verify']);
          assert.deepEqual(change[0]!.body, {password: 'Fresh password'});
          assert.equal(change[1]!.body.ceremonyId, flow === 'verify' || flow === 'browser-duplicate' || flow === 'failed-list' ? addedId : id, 'restart uses a new server-issued prompt');
        }
        assert.equal(await password.inputValue(), '');
        if (flow === 'options') {
          refusingAgain = true; await password.fill('Fresh password'); await action.click();
          await section.getByRole('alert').getByText(text.registration, {exact: true}).waitFor();
          const beforeWaitReads = reads, beforeWaitWrites = writes.length;
          assert.equal(await refresh.isDisabled(), true, 'the check button honors the response retry delay');
          await refresh.evaluate(el => (el as HTMLButtonElement).click());
          assert.equal(reads, beforeWaitReads); assert.equal(writes.length, beforeWaitWrites);
        }
      } finally {release(); await page.close();}
    }); } finally {await browser.close();}
  });
}
