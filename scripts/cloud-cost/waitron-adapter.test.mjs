import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adapter from './waitron-adapter.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const config = () => ({
  localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
    smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' },
});
// An external host, inherited sender, or an unexpected setting must fail before loading Waitron.
test('externalEndpointAndSenderRefused', () => {
  assert.equal(typeof adapter.validateReplayConfig, 'function');
  assert.doesNotThrow(() => adapter.validateReplayConfig(config()));
  for (const key of Object.keys(config().localEndpoints)) for (const host of ['example.com', 'host.docker.internal', '169.254.169.254', '127.0.0.2', 's3.example.com']) {
    const c = config(); const url = new URL(c.localEndpoints[key]); url.hostname = host; c.localEndpoints[key] = url.href;
    assert.throws(() => adapter.validateReplayConfig(c), { message: 'Invalid cloud cost replay configuration' });
  }
  for (const key of Object.keys(config().senders)) {
    const c = config(); c.senders[key] = 'production';
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
  for (const value of [null, {}, { ...config(), credentials: 'RAW_CANARY' }])
    assert.throws(() => adapter.validateReplayConfig(value), /Invalid cloud cost replay configuration/);
});
test('endpointQueryFragmentAndWrongProtocolRefused', () => {
  assert.equal(typeof adapter.validateReplayConfig, 'function');
  for (const value of ['https://s3:8333', 'http://s3:8333/?redirect=https://example.com', 'http://s3:8333/#RAW_CANARY', 'http://user:secret@s3:8333', 'http://127.1:8333']) {
    const c = config(); c.localEndpoints.s3 = value;
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
});
test('missingPrivateConfigRefused', () => {
  assert.equal(typeof adapter.validateReplayConfig, 'function');
  for (const key of Object.keys(config().localEndpoints)) {
    const c = config(); delete c.localEndpoints[key];
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
  for (const key of Object.keys(config().senders)) {
    const c = config(); delete c.senders[key];
    assert.throws(() => adapter.validateReplayConfig(c), /Invalid cloud cost replay configuration/);
  }
  const c = config(); Object.defineProperty(c.localEndpoints, 's3', { get() { throw Error('RAW_CANARY'); } });
  assert.throws(() => adapter.validateReplayConfig(c), e => e.message === 'Invalid cloud cost replay configuration' && !e.stack.includes('RAW_CANARY'));
});
function runtimeFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-replay-test-')));
  const codeRoot = join(root, 'code'); const stateRoot = join(root, 'state');
  mkdirSync(codeRoot, { mode: 0o700 }); mkdirSync(stateRoot, { mode: 0o700 });
  mkdirSync(join(codeRoot, 'packages/migrations'), { recursive: true });
  mkdirSync(join(codeRoot, 'packages/db/drizzle'), { recursive: true });
  writeFileSync(join(codeRoot, 'packages/migrations/migrations.manifest.json'), JSON.stringify([
    { name: 'core', table: '__drizzle_migrations_db', from: '../db/drizzle', appendOnlyTables: ['sales'] },
  ]));
  const marker = join(root, 'imported');
  const text = `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'RAW_CANARY');throw Error('RAW_CANARY_RUNTIME_IMPORTED');`;
  writeFileSync(join(codeRoot, 'runtime.mjs'), text);
  writeFileSync(join(codeRoot, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1,
    revision: 'fbadd15785464e59747e697c11048bfbc6e4938f', sha256: createHash('sha256').update(text).digest('hex') }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { codeRoot, stateRoot, config: config(), marker, initial: {
    taxpayer: { country: 'ES', taxId: '40000001K', legalName: 'Synthetic SL' },
    location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
      timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
    nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', idSistemaInformatico: 'WR',
  } };
}
// Unsafe paths/configuration must refuse before executing a prepared module or creating a venue.
test('runtimeRefusesUnsafePathsAndConfigurationBeforeImport', async t => {
  assert.equal(typeof adapter.openReplay, 'function');
  const args = runtimeFixture(t);
  const external = config(); external.localEndpoints.s3 = 'http://example.com:8333';
  for (const changed of [{ stateRoot: args.codeRoot }, { codeRoot: 'relative' },
    { stateRoot: join(args.codeRoot, 'nested') }, { config: external }, { config: {} },
    { initial: { credential: 'RAW_CANARY' } }]) {
    await assert.rejects(adapter.openReplay({ ...args, ...changed }),
      e => e.message === 'Invalid cloud cost replay runtime' && !e.stack.includes('RAW_CANARY'));
    assert.equal(existsSync(args.marker), false, 'the refused runtime must never be executed');
    assert.equal(existsSync(join(args.stateRoot, 'venue')), false);
  }
  const alias = join(args.stateRoot, 'alias'); symlinkSync(args.codeRoot, alias);
  await assert.rejects(adapter.openReplay({ ...args, codeRoot: alias }), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(args.marker), false);
  await assert.rejects(adapter.openReplay(args), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(args.marker), true, 'the valid boundary reaches the prepared module');
});
test('runtimeRefusesChangedBundleAndMigrationPathBeforeImport', async t => {
  const args = runtimeFixture(t);
  const manifestPath = join(args.codeRoot, 'runtime-manifest.json');
  const valid = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const changed of [{ revision: 'a'.repeat(40) }, { sha256: '0'.repeat(64) }, { schemaVersion: 2 }, { private: 'RAW_CANARY' }]) {
    writeFileSync(manifestPath, JSON.stringify({ ...valid, ...changed }));
    await assert.rejects(adapter.openReplay(args), /Invalid cloud cost replay runtime/);
    assert.equal(existsSync(args.marker), false);
  }
  writeFileSync(manifestPath, JSON.stringify(valid));
  const setsPath = join(args.codeRoot, 'packages/migrations/migrations.manifest.json');
  writeFileSync(setsPath, JSON.stringify([{ name: 'core', table: '__drizzle_migrations_db',
    from: '../../outside', appendOnlyTables: ['sales'] }]));
  await assert.rejects(adapter.openReplay(args), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(args.marker), false);
});
test('runtimeRefusesExistingVenueAndPublicStateBeforeImport', async t => {
  const args = runtimeFixture(t);
  chmodSync(args.stateRoot, 0o755);
  await assert.rejects(adapter.openReplay(args), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(args.marker), false);
  chmodSync(args.stateRoot, 0o700);
  mkdirSync(join(args.stateRoot, 'venue')); writeFileSync(join(args.stateRoot, 'venue/sentinel'), 'foreign');
  await assert.rejects(adapter.openReplay(args), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(args.marker), false);
  assert.equal(readFileSync(join(args.stateRoot, 'venue/sentinel'), 'utf8'), 'foreign');
});
test('runtimeRefusesUnknownOrMalformedInitialSettingsBeforeImport', async t => {
  const args = runtimeFixture(t);
  for (const change of [
    i => i.credential = 'RAW_CANARY', i => i.location.sender = 'RAW_CANARY',
    i => i.taxpayer.secret = 'RAW_CANARY', i => i.taxpayer.country = 'US',
    i => i.taxpayer.taxId = '', i => i.nodeName = null,
    i => i.location.invoiceLocales = [], i => i.location.dayCutover = '26:00:00',
    i => i.fullSeriesCode = i.seriesCode, i => i.idSistemaInformatico = 'WRONG',
  ]) {
    const initial = structuredClone(args.initial); change(initial);
    await assert.rejects(adapter.openReplay({ ...args, initial }), /Invalid cloud cost replay runtime/);
    assert.equal(existsSync(args.marker), false);
  }
});
test('runtimeRefusesDanglingVenueLinkBeforeImport', async t => {
  const args = runtimeFixture(t);
  symlinkSync(join(args.stateRoot, 'missing'), join(args.stateRoot, 'venue'));
  await assert.rejects(adapter.openReplay(args), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(args.marker), false, 'a dangling link is an existing destination');
});

// Full invoices require the issuer's address; configuring it must still use the closed private boundary.
test('fullInvoiceIssuerDomicileReachesThePinnedRuntimeWithoutOpeningExtraSettings', async t => {
  const args = runtimeFixture(t);
  args.initial.taxpayer.taxpayerDomicile = 'Synthetic issuer street';
  await assert.rejects(adapter.openReplay(args), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(args.marker), true, 'a valid issuer domicile reaches the pinned runtime');
});

test('malformedIssuerDomicileRefusesBeforeRuntimeImport', async t => {
  const args = runtimeFixture(t);
  for (const taxpayerDomicile of ['', '   ', null, 1, {}, 'x'.repeat(1024)]) {
    await assert.rejects(adapter.openReplay({ ...args, initial: { ...args.initial,
      taxpayer: { ...args.initial.taxpayer, taxpayerDomicile } } }), /Invalid cloud cost replay runtime/);
    assert.equal(existsSync(args.marker), false);
  }
});
