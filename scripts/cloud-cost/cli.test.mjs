import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, chmodSync, rmSync, symlinkSync, linkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const entry = new URL('./cli.mjs', import.meta.url);
const local = await import('./run-local.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./run-local.mjs', import.meta.url).href) return {};
  throw error;
});
const bad = { message: 'Invalid cloud cost local command' };
const config = () => ({ stage: 'replay-admission', source: '/PRIVATE_SOURCE', root: '/PRIVATE_ROOT',
  journal: { token: '0'.repeat(64), path: '/PRIVATE_JOURNAL' }, database: '/PRIVATE_DATABASE',
  codeRoot: '/PRIVATE_CODE', image: 'sha256:' + '0'.repeat(64), locationId: 'PRIVATE_LOCATION',
  expected: { sales: 4, paid: 4, tradingDays: 2, busiest: 3 },
  originalInventory: { timeZone: 'Europe/Madrid', days: 2, busiest: 3 },
  cadence: { mode: 'accelerated', factor: 100 }, replayWindowSeconds: 10, windowSeconds: 120,
  initial: {}, config: {} });
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-cli-')));
  chmodSync(root, 0o700); t.after(() => rmSync(root, { recursive: true }));
  const path = join(root, 'private.json'); writeFileSync(path, JSON.stringify(config()), { mode: 0o600 });
  return { root, path };
}
const child = argv => spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 5000,
  env: { PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });

// Removing file admission could expose config or block on a caller-supplied special file.
test('privateLocalConfigReadsOnlyAnExplicitAdmissionStageWithoutStartingWork', t => {
  assert.equal(typeof local.readLocalConfig, 'function', 'admit a bounded private config before running local work');
  const f = fixture(t);
  assert.deepEqual(local.readLocalConfig(f.path), config());
  assert.equal(existsSync('/PRIVATE_ROOT'), false);
});
for (const mode of ['missing', 'relative', 'symlink', 'parent-link', 'hardlink', 'directory', 'fifo',
  'readable', 'executable', 'empty', 'large', 'invalid-json', 'unknown-field', 'missing-field', 'renamed-field', 'wrong-stage', 'signal']) {
  test('privateLocalConfigRefuses_'+mode, t => {
    assert.equal(typeof local.readLocalConfig, 'function', 'refuse unsafe config before source access');
    const f = fixture(t); let path = f.path;
    if (mode === 'missing') path += '.missing';
    if (mode === 'relative') path = 'private.json';
    if (mode === 'symlink') { path += '.link'; symlinkSync(f.path, path); }
    if (mode === 'parent-link') { const link = f.root + '-link'; symlinkSync(f.root, link); t.after(() => rmSync(link)); path = join(link, 'private.json'); }
    if (mode === 'hardlink') linkSync(f.path, f.path + '.link');
    if (mode === 'directory') { path += '.dir'; mkdirSync(path, { mode: 0o700 }); }
    if (mode === 'fifo') { path += '.fifo'; assert.equal(spawnSync('mkfifo', [path]).status, 0); }
    if (mode === 'readable') chmodSync(path, 0o644);
    if (mode === 'executable') chmodSync(path, 0o700);
    if (mode === 'empty') writeFileSync(path, '');
    if (mode === 'large') writeFileSync(path, JSON.stringify(config()) + ' '.repeat(65536));
    if (mode === 'invalid-json') writeFileSync(path, 'PRIVATE_SYNTHETIC_INVALID_JSON');
    const value = config();
    if (mode === 'unknown-field') value.raw = 'PRIVATE_SYNTHETIC';
    if (mode === 'missing-field') delete value.journal;
    if (mode === 'renamed-field') { value.extra = value.journal; delete value.journal; }
    if (mode === 'wrong-stage') value.stage = 'cost-measurement';
    if (mode === 'signal') value.signal = {};
    if (['unknown-field', 'missing-field', 'renamed-field', 'wrong-stage', 'signal'].includes(mode)) writeFileSync(path, JSON.stringify(value));
    assert.throws(() => local.readLocalConfig(path), bad);
  });
}

// An import must not read argv config or run the command; rejection must not echo private input.
test('cliDoesNotRunOnImport', () => {
  const result = child(['--input-type=module', '-e', `process.argv=['node',${JSON.stringify(entry.pathname)},'local','--private-config','/PRIVATE_CANARY'];
    await import(${JSON.stringify(entry.href)}); process.stdout.write('IMPORTED');`]);
  assert.equal(result.status, 0); assert.equal(result.stdout, 'IMPORTED'); assert.equal(result.stderr, '');
});
for (const argv of [[], ['unknown'], ['local'], ['local', '--private-config', '/PRIVATE_CANARY'],
  ['local', '--private-config', '/PRIVATE_CANARY', '--cadence', 'original', '--window-seconds', 'NaN'],
  ['local', '--private-config', '/PRIVATE_CANARY', '--cadence', 'accelerated', '--window-seconds', '7201'],
  ['local', '--private-config', '/PRIVATE_CANARY', '--cadence', 'accelerated', '--window-seconds', '0'],
  ['local', '--private-config', '/PRIVATE_CANARY', '--cadence', 'fast', '--window-seconds', '120'],
  ['local', '--private-config', '/PRIVATE_CANARY', '--cadence', 'accelerated', '--window-seconds', '120', '--raw', 'PRIVATE_RAW'],
  ['local', '--private-config', '/PRIVATE_CANARY', '--cadence', 'accelerated', '--window-seconds', '120', '--cadence', 'original']]) {
  test('cliRefusesInvalidArgumentsWithoutRawOutput_'+JSON.stringify(argv), () => {
    const result = child([entry.pathname, ...argv]);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Cloud cost local command refused.\n');
  });
}

// CLI timing overrides must not silently change a separately reviewed private experiment.
test('runLocalRefusesDifferentCadenceWindowAndPrecancelledRunsBeforeResources', async t => {
  assert.equal(typeof local.runLocal, 'function', 'join private configuration to the foreground controller');
  const f = fixture(t), abort = new AbortController(); abort.abort();
  for (const changes of [{ cadence: 'original' }, { windowSeconds: 121 }, { signal: abort.signal }, { signal: {} }]) {
    await assert.rejects(local.runLocal({ privateConfig: f.path, cadence: 'accelerated', windowSeconds: 120, ...changes }), bad);
  }
});

// The effective user must own the config even when its permission bits look private.
test('privateLocalConfigRequiresTheEffectiveOwner', t => {
  const f = fixture(t);
  const result = child(['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {readLocalConfig} from ${JSON.stringify(new URL('./run-local.mjs', import.meta.url).href)};
    process.getuid = () => ${process.getuid() + 1};
    assert.throws(()=>readLocalConfig(process.argv[1]), {message:'Invalid cloud cost local command'});`, f.path]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

// A same-length rewrite during the read cannot silently alter an admitted private experiment.
test('privateLocalConfigRefusesARewriteDuringReading', t => {
  const f = fixture(t);
  const result = child(['--input-type=module', '-e', `
    import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; import assert from 'node:assert/strict';
    const original = fs.readSync, identity = fs.statSync(process.argv[1]); let changed = false;
    fs.readSync = (...args) => {
      const n=original(...args);
      if (!changed && fs.fstatSync(args[0]).ino === identity.ino) { changed=true; const text=fs.readFileSync(process.argv[1],'utf8');
        fs.writeFileSync(process.argv[1],text.replace('PRIVATE_SOURCE','ALTERED_SOURCE'));
        fs.utimesSync(process.argv[1],new Date(0),new Date(0)); }
      return n;
    };
    syncBuiltinESMExports();
    const {readLocalConfig}=await import(${JSON.stringify(new URL('./run-local.mjs', import.meta.url).href)});
    assert.throws(()=>readLocalConfig(process.argv[1]), {message:'Invalid cloud cost local command'});
    assert.equal(changed,true);`, f.path]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

test('cliRefusesMissingAndPrivateMalformedConfigWithoutEchoingIt', t => {
  const f = fixture(t);
  for (const path of [f.path + '.missing', f.path]) {
    const result = child([entry.pathname, 'local', '--private-config', path,
      '--cadence', 'accelerated', '--window-seconds', '120']);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Cloud cost local command refused.\n');
  }
});

// Streaming is a named partial experiment; it must never be silently accepted as admission-only.
test('privateLocalConfigAdmitsAnExplicitStreamReplayWithItsRequiredPrivateSettings', t => {
  const f = fixture(t), value = { ...config(), stage: 'stream-replay',
    stream: { copyImage: 'sha256:' + 'a'.repeat(64), binarySha256: 'b'.repeat(64), startupSeconds: 2, idleSeconds: 2, windowSeconds: 60 } };
  writeFileSync(f.path, JSON.stringify(value));
  assert.deepEqual(local.readLocalConfig(f.path), value);
});
for (const stage of ['replay-admission', 'stream-replay']) test('privateLocalConfigRequiresTheStageAndStreamSettingsToAgree_' + stage, t => {
  const f = fixture(t), value = { ...config(), stage };
  if (stage === 'replay-admission') value.stream = {};
  writeFileSync(f.path, JSON.stringify(value)); assert.throws(() => local.readLocalConfig(f.path), bad);
});
