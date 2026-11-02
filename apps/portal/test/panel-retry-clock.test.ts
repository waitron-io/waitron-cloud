import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {accountRequest} from '../src/api.ts';
import {InstallationController} from '../src/installation-controller.ts';
import {DiagnosticController} from '../src/diagnostic-controller.ts';
import {RemoteController} from '../src/remote-controller.ts';
import {RecoveryController} from '../src/recovery-controller.ts';
import {TranslationConsentController} from '../src/translation-consent-controller.ts';

const id = '10000000-0000-4000-8000-000000000001';
const start = Date.parse('2026-11-02T10:00:00Z');
const panels = ['installation', 'diagnostic', 'remote', 'recovery', 'translation consent'] as const;
function fixture(t: TestContext, panel: typeof panels[number]) {
  let wall = start, elapsed = 0;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => elapsed);
  for (const [name, value] of [['location', {protocol: 'https:'}], ['document', {cookie: '__Host-cloud_csrf=panel-clock'}]] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, value});
    t.after(() => {if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name);});
  }
  const replies: Array<Response | Promise<Response>> = [], calls: string[] = [], unexpected: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    calls.push(String(url));
    if (!replies.length) {unexpected.push(String(url)); throw Error('unplanned request');}
    return await replies.shift()!;
  });
  t.after(() => {assert.deepEqual(unexpected, []); assert.equal(replies.length, 0);});
  const c = panel === 'installation' ? new InstallationController(() => {})
    : panel === 'diagnostic' ? new DiagnosticController(() => {})
    : panel === 'remote' ? new RemoteController(() => {})
    : panel === 'recovery' ? new RecoveryController(() => {}) : new TranslationConsentController(() => {});
  c.account('owner');
  if (c instanceof RemoteController) c.installationId = id;
  if (c instanceof RecoveryController) {c.open(id); c.code = '01234567';}
  const perform = () => c instanceof DiagnosticController ? c.download(id)
    : c instanceof RecoveryController ? c.inspect() : c.load();
  return {c, calls, replies, perform, wall: (value: number) => {wall = value;}, elapsed: (value: number) => {elapsed = value;}};
}
function refused(retry?: string, date?: string) {
  return Response.json({error: 'rate_limited'}, {status: 429,
    headers: {...(retry ? {'Retry-After': retry} : {}), ...(date ? {Date: date} : {})}});
}

// A wall-clock deadline would bypass, extend or revive the real request gate.
for (const panel of panels) {
  for (const correction of [-3_600_000, 3_600_000]) test(`${panel}: retry wait follows elapsed time through correction ${correction}`, async t => {
    const f = fixture(t, panel);
    f.replies.push(refused('2')); await f.perform();
    f.wall(start + correction);
    assert.equal(f.c.waiting, 2); assert.equal(f.c.retryAt, start + correction + 2_000);
    f.elapsed(1_999); await f.perform(); assert.equal(f.calls.length, 1); assert.equal(f.c.waiting, 1);
    f.elapsed(2_000); assert.equal(f.c.waiting, 0); assert.equal(f.c.retryAt, 0);
    assert.equal(f.calls.length, 1, 'expiry requires an explicit retry');
    f.replies.push(refused()); await f.perform(); assert.equal(f.calls.length, 2);
  });
  test(`${panel}: expired wait stays expired after rollback during a pending refusal`, async t => {
    const f = fixture(t, panel);
    f.replies.push(refused('2')); await f.perform();
    f.elapsed(2_000); f.wall(start + 2_000); assert.equal(f.c.waiting, 0);
    let release!: (response: Response) => void;
    f.replies.push(new Promise(resolve => {release = resolve;}));
    const pending = f.perform(); assert.equal(f.c.pending, true);
    f.wall(start - 3_600_000); release(refused()); await pending;
    assert.equal(f.c.waiting, 0); assert.equal(f.c.retryAt, 0);
    f.replies.push(refused()); await f.perform(); assert.equal(f.calls.length, 3);
  });
  test(`${panel}: account changes retain a live wait without reviving its expired deadline`, async t => {
    const f = fixture(t, panel);
    f.replies.push(refused('2')); await f.perform();
    f.c.account('next-owner'); f.wall(start - 3_600_000);
    assert.equal(f.c.waiting, 2);
    f.elapsed(2_000); assert.equal(f.c.waiting, 0); assert.equal(f.c.retryAt, 0);
    f.wall(start - 7_200_000); assert.equal(f.c.waiting, 0);
  });
}

const paths = ['/installations', '/installations/revoke', '/diagnostics/read', '/remote-access/status', '/remote-access/dns',
  '/remote-access/apply', '/recovery/inspect', '/recovery/approve', '/recovery/close', '/recovery/replace', '/translation-consent'];
// Reading JSON must consume the original header wait, including when the server clock differs.
for (const path of paths) for (const entry of [
  {name: 'seconds', retry: '2', date: undefined},
  {name: 'server ahead', retry: 'Mon, 02 Nov 2026 11:00:02 GMT', date: 'Mon, 02 Nov 2026 11:00:00 GMT'},
  {name: 'server behind', retry: 'Mon, 02 Nov 2026 09:00:02 GMT', date: 'Mon, 02 Nov 2026 09:00:00 GMT'},
  {name: 'missing Date', retry: 'Mon, 02 Nov 2026 10:00:02 GMT', date: undefined},
  {name: 'invalid Date', retry: 'Mon, 02 Nov 2026 10:00:02 GMT', date: 'invalid'},
]) for (const consumed of [1_500, 5_000]) test(`${path}: ${entry.name} body consumes ${consumed}ms of retry wait`, async t => {
  const f = fixture(t, 'installation');
  const response = refused(entry.retry, entry.date), json = response.json.bind(response);
  t.mock.method(response, 'json', async () => {f.elapsed(consumed); f.wall(start - 3_600_000); return await json();});
  f.replies.push(response);
  const result = await accountRequest(path, path === '/installations' ? undefined : {});
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('refused status accepted');
  assert.equal(result.retryAfterMs, consumed === 1_500 ? 500 : 0);
  assert.equal(result.code, 'rate_limited'); assert.equal(f.calls.length, 1);
});
