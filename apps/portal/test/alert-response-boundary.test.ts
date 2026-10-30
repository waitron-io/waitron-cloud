import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {AlertController} from '../src/alert-controller.ts';

function browser(t: TestContext) {
  for (const [name, value] of [
    ['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=alert-proof'}],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

const malformed = [
  {name: 'null preferences', value: null},
  {name: 'array preferences', value: []},
  {name: 'string preferences', value: 'enabled'},
  {name: 'missing enabled', value: {locale: 'es'}},
  {name: 'string enabled', value: {enabled: 'off', locale: 'es'}},
  {name: 'numeric enabled', value: {enabled: 0, locale: 'en'}},
  {name: 'null enabled', value: {enabled: null, locale: 'es'}},
  {name: 'missing locale', value: {enabled: false}},
  {name: 'uppercase locale', value: {enabled: false, locale: 'ES'}},
  {name: 'unsupported locale', value: {enabled: false, locale: 'fr'}},
  {name: 'null locale', value: {enabled: false, locale: null}},
  {name: 'numeric locale', value: {enabled: false, locale: 1}},
];
const failures = [
  ...malformed.map(entry => ({name: entry.name, status: 503, reply: () => Response.json(entry.value)})),
  {name: 'broken JSON', status: 503, reply: () => new Response('{"enabled":false,')},
  {name: 'lost transport', status: 0, reply: (): Response => { throw new TypeError('fixture connection lost'); }},
];

for (const operation of ['initial read', 'reload', 'save'] as const) {
  for (const entry of failures) {
    test(`alert ${operation} with ${entry.name} stays unconfirmed and permits a valid retry`, async t => {
      browser(t);
      let response = () => Response.json({enabled: true, locale: 'es'});
      const calls: RequestInit[] = [];
      t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
        assert.equal(url, '/api/account/alerts');
        calls.push(init!);
        return response();
      });
      const controller = new AlertController(() => {}, accountRequest);
      controller.account('owner');
      if (operation !== 'initial read') {
        await controller.load();
        controller.choose(false, 'en');
      }
      response = entry.reply;
      const invalid = await accountRequest('/alerts');
      assert.equal(invalid.ok, false);
      if (invalid.ok) assert.fail('invalid preferences were accepted');
      assert.equal(invalid.status, entry.status);
      assert.equal(invalid.code, entry.status === 0 ? 'network_error' : 'unexpected_response');
      calls.length = 0;
      if (operation === 'save') await controller.save();
      else await controller.load();
      assert.equal(controller.pending, false);
      assert.equal(controller.saved, false);
      assert.equal(controller.enabled, false);
      assert.equal(controller.locale, 'en');
      assert.equal(controller.loaded, operation !== 'initial read');
      assert.equal(controller.dirty, operation !== 'initial read');
      assert.equal(controller.error, operation === 'save' ? 'alertsUncertain' : 'unavailable');
      assert.equal(controller.waiting, 0);
      assert.equal(calls.length, 1, 'failed operations must not retry themselves');
      const failed = calls[0]!;
      assert.equal(failed.method, operation === 'save' ? 'POST' : 'GET');
      assert.equal(failed.credentials, 'same-origin');
      if (operation === 'save') {
        assert.deepEqual(JSON.parse(String(failed.body)), {enabled: 'off', locale: 'en'});
        assert.equal(new Headers(failed.headers).get('X-CSRF-Token'), 'alert-proof');
        controller.choose(true, 'es');
        assert.equal(controller.dirty, true, 'reverting cannot confirm an uncertain server write');
      } else {
        assert.equal(failed.body, undefined);
        assert.equal(new Headers(failed.headers).has('X-CSRF-Token'), false);
      }
      response = () => Response.json({enabled: true, locale: 'en'});
      if (operation === 'save') await controller.save();
      else await controller.load();
      assert.equal(calls.length, 2);
      if (operation === 'save') assert.deepEqual(JSON.parse(String(calls[1]!.body)), {enabled: 'on', locale: 'es'});
      assert.equal(controller.enabled, true);
      assert.equal(controller.locale, 'en', 'the confirmed server reply replaces the submitted draft');
      assert.equal(controller.loaded, true);
      assert.equal(controller.dirty, false);
      assert.equal(controller.pending, false);
      assert.equal(controller.saved, operation === 'save');
      assert.equal(controller.error, undefined);
      await controller.save();
      assert.equal(calls.length, 2, 'a confirmed unchanged choice must not send another write');
    });
  }
}

for (const operation of ['reload', 'save'] as const) {
  for (const status of [401, 403]) {
    test(`alert ${operation} with HTTP ${status} clears choices and prevents an unloaded save`, async t => {
      browser(t);
      let denied = false;
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        return Response.json({enabled: true, locale: 'es'}, {status: denied ? status : 200});
      });
      const controller = new AlertController(() => {}, accountRequest);
      controller.account('owner');
      await controller.load();
      controller.choose(false, 'en');
      denied = true;
      if (operation === 'save') await controller.save();
      else await controller.load();
      assert.equal(controller.loaded, false);
      assert.equal(controller.enabled, false);
      assert.equal(controller.locale, 'en');
      assert.equal(controller.saved, false);
      assert.equal(controller.pending, false);
      assert.equal(controller.dirty, false);
      assert.equal(controller.error, status === 401 ? 'pairSession' : 'forbidden');
      await controller.save();
      assert.equal(requests, 2);
      denied = false;
      await controller.load();
      assert.equal(controller.loaded, true);
      assert.equal(controller.enabled, true);
      assert.equal(controller.locale, 'es');
      assert.equal(controller.error, undefined);
      assert.equal(requests, 3);
    });
  }

  test(`alert ${operation} with HTTP 429 waits before retrying the current choices`, async t => {
    browser(t);
    t.mock.timers.enable({apis: ['Date'], now: 100000});
 t.mock.method(performance,'now',()=>Date.now()-100000);
    let limited = false;
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return limited
        ? Response.json({error: 'rate_limited'}, {status: 429, headers: {'Retry-After': '7'}})
        : Response.json({enabled: true, locale: 'es'});
    });
    const controller = new AlertController(() => {}, accountRequest);
    controller.account('owner');
    await controller.load();
    controller.choose(false, 'en');
    limited = true;
    if (operation === 'save') await controller.save();
    else await controller.load();
    assert.equal(controller.waiting, 7);
    assert.equal(controller.error, 'limited');
    assert.equal(controller.loaded, true);
    assert.equal(controller.enabled, false);
    assert.equal(controller.locale, 'en');
    assert.equal(controller.saved, false);
    assert.equal(controller.pending, false);
    assert.equal(controller.dirty, true);
    await controller.load();
    await controller.save();
    assert.equal(requests, 2);
    t.mock.timers.tick(6999);
    await controller.save();
    assert.equal(requests, 2);
    t.mock.timers.tick(1);
    limited = false;
    if (operation === 'save') await controller.save();
    else await controller.load();
    assert.equal(requests, 3);
    assert.equal(controller.waiting, 0);
    assert.equal(controller.error, undefined);
    assert.equal(controller.enabled, true);
    assert.equal(controller.locale, 'es');
    assert.equal(controller.dirty, false);
    assert.equal(controller.saved, operation === 'save');
  });
}

for (const enabled of [false, true]) {
  for (const locale of ['en', 'es']) {
    test(`valid alert preferences confirm enabled=${enabled} and locale=${locale}`, async t => {
      browser(t);
      t.mock.method(globalThis, 'fetch', async () => Response.json({enabled, locale}));
      const controller = new AlertController(() => {}, accountRequest);
      controller.account('owner');
      await controller.load();
      assert.equal(controller.enabled, enabled);
      assert.equal(controller.locale, locale);
      assert.equal(controller.loaded, true);
      assert.equal(controller.pending, false);
      assert.equal(controller.dirty, false);
      assert.equal(controller.error, undefined);
    });
  }
}
