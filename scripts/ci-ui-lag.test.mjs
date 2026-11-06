import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const implementation = await import('./ci-ui-lag.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const now = Date.parse('2026-11-06T12:00:00Z');
const metadata = {
  name: '@waitron-io/ui-core',
  'dist-tags': {latest: '0.2.12'},
  versions: {'0.1.0': {}, '0.2.9': {}, '0.2.10': {}, '0.2.12': {}, '0.3.0-beta.1': {}},
  time: {'0.1.0': '2026-09-23T12:00:00Z', '0.2.9': '2026-10-29T12:00:00Z',
    '0.2.10': '2026-11-06T10:00:00Z', '0.2.12': '2026-11-06T11:00:00Z', '0.3.0-beta.1': '2026-10-01T12:00:00Z'},
};
const apiVersions = data => Object.keys(data.versions ?? {}).map((name, i) => ({
  id: i + 1, name, url: `https://api.github.com/orgs/waitron-io/packages/npm/ui-core/versions/${i + 1}`,
  package_html_url: 'https://github.com/orgs/waitron-io/packages/npm/package/ui-core',
  html_url: `https://github.com/orgs/waitron-io/packages/npm/ui-core/${i + 1}`,
  created_at: data.time?.[name], updated_at: data.time?.[name], metadata: {package_type: 'npm'},
}));
function evaluate(version, data = metadata, at = now) {
  assert.equal(typeof implementation.evaluateUiLag, 'function', 'UI lag evaluation is missing');
  return implementation.evaluateUiLag(version, data, at);
}

test('an old version without a newer stable release remains current', () => {
  assert.equal(evaluate('0.2.12').status, 'current');
});
test('the earliest newer publication keeps its deadline when later releases arrive', () => {
  assert.equal(evaluate('0.1.0').status, 'overdue');
});
test('exactly seven days is allowed and the next millisecond is overdue', () => {
  assert.equal(evaluate('0.1.0', metadata, Date.parse('2026-11-05T12:00:00Z')).status, 'current');
  assert.equal(evaluate('0.1.0', metadata, Date.parse('2026-11-05T12:00:00.001Z')).status, 'overdue');
});
test('version comparison uses numeric components and ignores prereleases', () => {
  assert.equal(evaluate('0.2.10').status, 'current');
  assert.equal(evaluate('0.3.0').status, 'unknown');
});
test('a later lower version cannot hide an earlier higher-version publication', () => {
  const data = structuredClone(metadata);
  data.time['0.2.9'] = '2026-11-06T11:00:00Z';
  data.time['0.2.12'] = '2026-10-29T12:00:00Z';
  assert.equal(evaluate('0.1.0', data).status, 'overdue');
});
for (const [label, change] of [
  ['missing installed version', data => delete data.versions['0.1.0']],
  ['missing publication times', data => delete data.time],
  ['missing newer publication time', data => delete data.time['0.2.9']],
  ['invalid newer publication time', data => data.time['0.2.9'] = 'not a date'],
]) test(`${label} warns rather than inventing an overdue version`, () => {
  const data = structuredClone(metadata); change(data);
  assert.equal(evaluate('0.1.0', data).status, 'unknown');
});
test('a known overdue publication still fails when another timestamp is missing', () => {
  const data = structuredClone(metadata); delete data.time['0.2.12'];
  assert.equal(evaluate('0.1.0', data).status, 'overdue');
});

async function run({versions = ['0.1.0', '0.2.12'], fetchImpl = async () => Response.json(apiVersions(metadata))} = {}) {
  assert.equal(typeof implementation.checkUiLag, 'function', 'UI lag CI command is missing');
  const root = mkdtempSync(join(tmpdir(), 'cloud-ui-lag-'));
  const messages = [];
  try {
    for (const [i, path] of ['apps/portal', 'packages/ui-smoke'].entries()) {
      mkdirSync(join(root, path), {recursive: true});
      writeFileSync(join(root, path, 'package.json'), JSON.stringify({dependencies: {'@waitron-io/ui-core': versions[i]}}));
    }
    const code = await implementation.checkUiLag({root, now, token: 'test-package-read', fetchImpl, report: message => messages.push(message)});
    return {code, messages};
  } finally { rmSync(root, {recursive: true, force: true}); }
}
test('both consumers are checked so a current portal cannot hide an overdue smoke package', async () => {
  const result = await run({versions: ['0.2.12', '0.1.0']});
  assert.equal(result.code, 1);
  assert(result.messages.some(line => line.includes('packages/ui-smoke') && line.includes('::error::')));
});
test('current pins pass the CI command', async () => {
  assert.equal((await run({versions: ['0.2.12', '0.2.12']})).code, 0);
});
for (const [label, fetchImpl] of [
  ['registry refusal', async () => new Response('unavailable', {status: 503})],
  ['malformed registry JSON', async () => new Response('not JSON')],
  ['lookup timeout', async () => {throw new DOMException('secret text', 'TimeoutError');}],
]) test(`${label} warns and passes without exposing error details`, async () => {
  const result = await run({fetchImpl});
  assert.equal(result.code, 0);
  assert(result.messages.some(line => line.includes('::warning::')));
  assert(!result.messages.join('\n').includes('secret text'));
});

test('the registry request authenticates and reads full metadata over HTTP', async () => {
  const {createServer} = await import('node:http');
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer test-package-read' || request.headers.accept !== 'application/vnd.github+json') {
      response.writeHead(401); response.end(); return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(apiVersions(metadata)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await run({fetchImpl: (url, options) => {
      assert.equal(url, 'https://api.github.com/orgs/waitron-io/packages/npm/ui-core/versions?per_page=100&page=1');
      assert.equal(options.redirect, 'error');
      assert(options.signal instanceof AbortSignal);
      return fetch(`http://127.0.0.1:${server.address().port}/`, options);
    }});
    assert.equal(result.code, 1);
    assert(result.messages.some(line => line.includes('::error::')));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('malformed or unavailable version metadata cannot manufacture a deadline', () => {
  for (const data of [null, {}, {versions: null}, {versions: {}}, {versions: []}]) assert.equal(evaluate('0.1.0', data).status, 'unknown');
  for (const pin of [undefined, '^0.1.0', '0.1.0-beta.1']) assert.equal(evaluate(pin).status, 'unknown');
});

test('stable build metadata does not change version ordering', () => {
  const data = {versions: {'1.0.0+cloud': {}, '1.0.0+source': {}, '1.0.1+source': {}},
    time: {'1.0.0+source': '2026-10-01T12:00:00Z', '1.0.1+source': '2026-11-06T11:00:00Z'}};
  assert.equal(evaluate('1.0.0+cloud', data).status, 'current');
});


test('the actual CI command exits nonzero only for known overdue pins', async () => {
  const {spawnSync} = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'cloud-ui-lag-cli-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('./ci-ui-lag.mjs', import.meta.url), join(root, 'scripts/ci-ui-lag.mjs'));
    for (const path of ['apps/portal', 'packages/ui-smoke']) {
      mkdirSync(join(root, path), {recursive: true});
      writeFileSync(join(root, path, 'package.json'), JSON.stringify({dependencies: {'@waitron-io/ui-core': '0.1.0'}}));
    }
    for (const [label, data, expected] of [
      ['overdue', metadata, 1],
      ['current', {versions: {'0.1.0': {}}, time: {}}, 0],
      ['unknown', {}, 0],
    ]) {
      const preload = `Date.now = () => ${now}; globalThis.fetch = async () => Response.json(${JSON.stringify(apiVersions(data))});`;
      const child = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), 'scripts/ci-ui-lag.mjs'],
        {cwd: root, encoding: 'utf8', timeout: 5000, env: {...process.env, NODE_AUTH_TOKEN: 'test-package-read'}});
      assert.equal(child.status, expected, label + child.stderr + child.stdout);
      assert.equal(child.signal, null);
      if (expected === 1) assert.match(child.stdout, /::error::packages\/ui-smoke/);
      if (label === 'unknown') assert.match(child.stdout, /::warning::/);
      assert(!child.stdout.includes('test-package-read'));
    }
  } finally {rmSync(root, {recursive: true, force: true});}
});


test('publication dates on later API pages retain the earliest deadline', async () => {
  const first = [{name: '0.1.0', created_at: '2026-09-23T12:00:00Z'},
    ...Array.from({length: 99}, (_, i) => ({name: `0.3.0-beta.${i}`, created_at: '2026-10-01T12:00:00Z'}))];
  const result = await run({fetchImpl: async url => {
    const page = new URL(url).searchParams.get('page');
    if (page === '1') return Response.json(first);
    assert.equal(page, '2');
    return Response.json([{name: '0.2.9', created_at: '2026-10-29T12:00:00Z'}, {name: '0.2.12', created_at: '2026-11-06T11:00:00Z'}]);
  }});
  assert.equal(result.code, 1);
});

test('a failed later API page warns because the version inventory is incomplete', async () => {
  const first = Array.from({length: 100}, (_, i) => ({name: `0.2.${i}`, created_at: '2026-10-01T12:00:00Z'}));
  const result = await run({fetchImpl: async url => new URL(url).searchParams.get('page') === '1'
    ? Response.json(first) : new Response('unavailable', {status: 503})});
  assert.equal(result.code, 0);
  assert(result.messages.some(line => line.includes('::warning::')));
});
