import {standardNextNumber} from './replay-series-fixture.mjs';
import {createHash} from 'node:crypto';
// This explicit local integration command uses prepared public code and synthetic sales only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as adapter from '../waitron-adapter.mjs';

const fixture = JSON.parse(readFileSync(process.env.COST_SYNTHETIC_CONFIG, 'utf8'));
const initial = {
  taxpayer: { country: 'ES', taxId: '12345678Z', legalName: 'Synthetic SL' },
  location: { name: 'Synthetic venue', invoiceLocales: ['es'], operationDescription: 'Servicio',
    timeZone: 'Europe/Madrid', dayCutover: '06:00:00' },
  nodeName: 'Synthetic node', seriesCode: 'R', fullSeriesCode: 'F', rectificativeSeriesCode: 'C', idSistemaInformatico: 'W1',
};
const config = {
  localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture',
    smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
  senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' },
};
const sale = i => {
  const instant = new Date(Date.UTC(2026, 0, 1, 12, i));
  return { origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'],
    total: '12.10', lines: [{ lineNo: 1, name: 'Synthetic item', descriptions: { es: 'Synthetic item' },
      quantity: '1', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
    clock: { now: () => ({ instant, offsetMinutes: 60, confident: true, confidence: 'anchored', anchorAgeSeconds: 0 }) },
    settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } };
};
async function open(t) {
  assert.equal(typeof adapter.openReplay, 'function', 'the adapter must invoke the prepared real Waitron runtime');
  const stateRoot = mkdtempSync(join(fixture.stateParent, 'conformance-')); chmodSync(stateRoot, 0o700);
  let replay;
  t.after(async () => { try { await replay?.close(); } finally { rmSync(stateRoot, { recursive: true, force: true }); } });
  replay = await adapter.openReplay({ codeRoot: fixture.codeRoot, stateRoot, config, initial });
  return { replay, stateRoot };
}
// Bypassing recordSale, changing its inputs, or omitting transactions breaks these stored effects.
test('allBillsReplayedThroughRecordSale', async t => {
  const { replay, stateRoot } = await open(t);
  await Promise.all([replay.recordSale(sale(0)), replay.recordSale(sale(1)), replay.recordSale(sale(2))]);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.deepEqual(db.prepare('SELECT invoice_number, total FROM sales ORDER BY invoice_number').all()
      .map(r => ({ ...r })), [{ invoice_number: 1, total: 1210 }, { invoice_number: 2, total: 1210 }, { invoice_number: 3, total: 1210 }]);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sale_lines').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM tenders').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sale_settlements').get().n, 3);
    assert.equal(db.prepare("SELECT count(*) AS n FROM envios WHERE estado='pendiente'").get().n, 3);
    assert.equal(standardNextNumber(db,stateRoot), 4);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 3);
    const hashes = db.prepare('SELECT huella FROM registros_facturacion ORDER BY secuencia').all();
    assert.equal(new Set(hashes.map(r => r.huella)).size, 3);
    assert.ok(hashes.every(r => /^[A-F0-9]{64}$/.test(r.huella)));
  } finally { db.close(); }
  const writer = new DatabaseSync(join(stateRoot, 'venue/venue.db'));
  try { assert.throws(() => writer.prepare('UPDATE sales SET total=0').run(), /append.only/); }
  finally { writer.close(); }
  assert.deepEqual(await replay.verify(), { ok: true, issues: 0 });
  assert.deepEqual(replay.counts(), { attempted: 3, successful: 3, failed: 0 });
});
test('failedSaleRollsBackWithoutWeakeningNormalChecks', async t => {
  const { replay, stateRoot } = await open(t); const invalid = sale(0);
  invalid.vatBreakdown = [{ rate: '21.00', base: '10.00', tax: '0' }];
  await assert.rejects(replay.recordSale(invalid), { message: 'Invalid cloud cost replay runtime' });
  await replay.recordSale(sale(1));
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 1);
    assert.equal(db.prepare('SELECT invoice_number AS n FROM sales').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 1);
  } finally { db.close(); }
  assert.deepEqual(replay.counts(), { attempted: 2, successful: 1, failed: 1 });
});
test('closeWaitsForAdmittedSalesAndIsIdempotent', async t => {
  const { replay, stateRoot } = await open(t);
  const submitted = replay.recordSale(sale(0)); const closing = replay.close();
  await assert.doesNotReject(submitted); await closing; await replay.close();
  await assert.rejects(replay.recordSale(sale(1)), /Invalid cloud cost replay runtime/);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 1); }
  finally { db.close(); }
});
// Removing the transaction would leave the sale and allocated number after settlement refuses it.
test('lateSettlementFailureRollsBackSaleAndAllocation', async t => {
  const { replay, stateRoot } = await open(t); const invalid = sale(0);
  invalid.settlement.tenders[0].amount = '11.00';
  await assert.rejects(replay.recordSale(invalid), /Invalid cloud cost replay runtime/);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM tenders').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 0);
    assert.equal(standardNextNumber(db,stateRoot), 1);
  } finally { db.close(); }
  await replay.recordSale(sale(1));
  assert.deepEqual(replay.counts(), { attempted: 2, successful: 1, failed: 1 });
});
test('sourceIdentityCannotBeInjectedIntoFreshReplay', async t => {
  const { replay, stateRoot } = await open(t);
  for (const identity of [{ nodeId: 'source-node' }, { seriesId: 'source-series' }])
    await assert.rejects(replay.recordSale({ ...sale(0), ...identity }), /Invalid cloud cost replay runtime/);
  const db = new DatabaseSync(join(stateRoot, 'venue/venue.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 0);
    assert.equal(standardNextNumber(db,stateRoot), 1);
  } finally { db.close(); }
  assert.deepEqual(replay.counts(), { attempted: 2, successful: 0, failed: 2 });
});

async function archiveFixture(t) {
  const f = await open(t);
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(join(f.stateRoot, 'tls'), { mode: 0o700 });
  for (const name of ['secrets.env', 'tls/ca.crt', 'tls/ca.key', 'tls/server.crt', 'tls/server.key'])
    writeFileSync(join(f.stateRoot, name), 'SYNTHETIC_PRIVATE_STATE', { mode: 0o600 });
  return f;
}

// Skipping genuine capture, identity restoration, or fiscal hooks changes these durable effects.
test('captureAndRestoreUseRealArchiveAndRestoreHooks', async t => {
  const { replay, stateRoot } = await archiveFixture(t);
  await replay.recordSale(sale(0)); await replay.recordSale(sale(1));
  assert.equal(typeof replay.capture, 'function', 'capture must use Waitron archive creation');
  const capture = await replay.capture({ recoveryKey: 'synthetic-recovery-key', at: new Date('2026-01-02T12:00:00Z'), signal: new AbortController().signal });
  assert.ok(capture.bytes instanceof Uint8Array && capture.bytes.length > 1000);
  assert.ok(capture.modules.core > 0 && capture.modules['fiscal-verifactu'] > 0);
  const expectedModules = JSON.parse(readFileSync(join(fixture.codeRoot, 'packages/migrations/migrations.manifest.json'), 'utf8')).map(m => m.name);
  assert.deepEqual(Object.keys(capture.modules).sort(), expectedModules.sort());
  assert.equal(typeof replay.restore, 'function', 'restore must use Waitron restore and hooks');
  const restored = await replay.restore({ artifact: capture.bytes, recoveryKey: 'synthetic-recovery-key' });
  assert.deepEqual(restored, { ok: true, issues: 0, sales: 2 });
  const db = new DatabaseSync(join(stateRoot, 'restored/venue/venue.db'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM sales').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registros_facturacion').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM registro_sif').get().n, 2, 'the genuine fiscal restore hook creates a new installation');
    assert.equal(db.prepare('SELECT count(*) AS n FROM invoice_series WHERE retired_at IS NULL').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM invoice_series WHERE retired_at IS NOT NULL').get().n, 2);
  } finally { db.close(); }
  assert.equal(readFileSync(join(stateRoot, 'restored/secrets.env'), 'utf8'), 'SYNTHETIC_PRIVATE_STATE');
  assert.equal(readFileSync(join(stateRoot, 'restored/trading.env'), 'utf8'), readFileSync(join(stateRoot, 'trading.env'), 'utf8'));
});

// A path redirected after opening must never let capture remove a foreign staging folder.
test('captureRefusesRedirectedStateBeforeWritingOutsideScratch', async t => {
  const { replay, stateRoot } = await archiveFixture(t);
  const { mkdirSync, writeFileSync, symlinkSync } = await import('node:fs');
  const foreign = mkdtempSync(join(fixture.stateParent, 'foreign-'));
  t.after(() => rmSync(foreign, { recursive: true, force: true }));
  mkdirSync(join(foreign, 'staging')); writeFileSync(join(foreign, 'staging/sentinel'), 'foreign');
  symlinkSync(foreign, join(stateRoot, 'cloud-snapshots'));
  await assert.rejects(replay.capture({ recoveryKey: 'synthetic-key', at: new Date(), signal: new AbortController().signal }),
    { message: 'Invalid cloud cost replay runtime' });
  assert.equal(readFileSync(join(foreign, 'staging/sentinel'), 'utf8'), 'foreign');
});

test('failedRestoreRemovesOnlyItsPartialDestinationAndCanRetry', async t => {
  const { replay, stateRoot } = await archiveFixture(t);
  await replay.recordSale(sale(0));
  const capture = await replay.capture({ recoveryKey: 'synthetic-key', at: new Date(), signal: new AbortController().signal });
  await assert.rejects(replay.restore({ artifact: capture.bytes, recoveryKey: 'wrong-key' }),
    { message: 'Invalid cloud cost replay runtime' });
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(stateRoot, 'restored')), false, 'failed restore must clean its owned partial destination');
  assert.deepEqual(await replay.restore({ artifact: capture.bytes, recoveryKey: 'synthetic-key' }), { ok: true, issues: 0, sales: 1 });
  await assert.rejects(replay.restore({ artifact: capture.bytes, recoveryKey: 'synthetic-key' }), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(join(stateRoot, 'restored/venue/venue.db')), true, 'completed restore must not be overwritten');
});

test('emptyRecoveryKeyRefusedBeforeArchiveCreation', async t => {
  const { replay, stateRoot } = await archiveFixture(t);
  await assert.rejects(replay.capture({ recoveryKey: '', at: new Date(), signal: new AbortController().signal }),
    { message: 'Invalid cloud cost replay runtime' });
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(stateRoot, 'cloud-snapshots')), false);
});

test('captureRefusesReplacedRootAndChangedPermissions', async t => {
  const { replay, stateRoot } = await archiveFixture(t);
  const { renameSync, cpSync, existsSync } = await import('node:fs');
  const saved = `${stateRoot}-saved`;
  renameSync(stateRoot, saved);
  t.after(() => rmSync(saved, { recursive: true, force: true }));
  cpSync(saved, stateRoot, { recursive: true }); chmodSync(stateRoot, 0o700);
  const options = { recoveryKey: 'synthetic-key', at: new Date(), signal: new AbortController().signal };
  await assert.rejects(replay.capture(options), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(join(stateRoot, 'cloud-snapshots')), false);
  rmSync(stateRoot, { recursive: true }); renameSync(saved, stateRoot); chmodSync(stateRoot, 0o755);
  await assert.rejects(replay.capture(options), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(join(stateRoot, 'cloud-snapshots')), false);
  chmodSync(stateRoot, 0o700);
});

test('captureRequiresCompletePrivateStateAndHonoursCancellation', async t => {
  const { replay, stateRoot } = await open(t);
  const options = { recoveryKey: 'synthetic-key', at: new Date(), signal: new AbortController().signal };
  await assert.rejects(replay.capture(options), { message: 'Invalid cloud cost replay runtime' });
  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs');
  assert.equal(existsSync(join(stateRoot, 'cloud-snapshots/staging')), false);
  mkdirSync(join(stateRoot, 'tls'));
  for (const name of ['secrets.env', 'tls/ca.crt', 'tls/ca.key', 'tls/server.crt', 'tls/server.key'])
    writeFileSync(join(stateRoot, name), 'SYNTHETIC_PRIVATE_STATE', { mode: 0o600 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(replay.capture({ ...options, signal: controller.signal }), { message: 'Invalid cloud cost replay runtime' });
  assert.equal(existsSync(join(stateRoot, 'cloud-snapshots/staging')), false);
  assert.ok((await replay.capture(options)).bytes.length > 1000);
});

test('closeWaitsForAdmittedCaptureAndLaterCaptureIsRefused', async t => {
  const { replay } = await archiveFixture(t);
  const options = { recoveryKey: 'synthetic-key', at: new Date(), signal: new AbortController().signal };
  const capturing = replay.capture(options); const closing = replay.close();
  assert.ok((await capturing).bytes.length > 1000);
  await closing;
  await assert.rejects(replay.capture(options), /Invalid cloud cost replay runtime/);
});

test('restoreRefusesLinkedStateBeforeCreatingDestination', async t => {
  const { replay, stateRoot } = await archiveFixture(t);
  const capture = await replay.capture({ recoveryKey: 'synthetic-key', at: new Date(), signal: new AbortController().signal });
  const { symlinkSync, existsSync } = await import('node:fs');
  symlinkSync(fixture.codeRoot, join(stateRoot, 'untrusted'));
  await assert.rejects(replay.restore({ artifact: capture.bytes, recoveryKey: 'synthetic-key' }), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(join(stateRoot, 'restored')), false);
});

// Failure injection replaces only the newly created destination, never the real source runtime.
test('failedRestorePreservesAReplacedDestination', async t => {
  const { cpSync, writeFileSync, existsSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const codeRoot = mkdtempSync(join(fixture.stateParent, 'wrapper-'));
  const stateRoot = mkdtempSync(join(fixture.stateParent, 'cleanup-'));
  chmodSync(codeRoot, 0o700); chmodSync(stateRoot, 0o700);
  let replay;
  t.after(async () => { try { await replay?.close(); } finally {
    rmSync(stateRoot, { recursive: true, force: true }); rmSync(codeRoot, { recursive: true, force: true });
  } });
  cpSync(join(fixture.codeRoot, 'packages'), join(codeRoot, 'packages'), { recursive: true });
  cpSync(join(fixture.codeRoot, 'assets'), join(codeRoot, 'assets'), { recursive: true });
  const source = `export * from ${JSON.stringify(pathToFileURL(join(fixture.codeRoot, 'runtime.mjs')).href)};
import {renameSync,mkdirSync,writeFileSync} from 'node:fs';
export async function restoreFromArtifact(deps) {
 renameSync(deps.stateDir,deps.stateDir+'-original');mkdirSync(deps.stateDir,{mode:0o700});
 writeFileSync(deps.stateDir+'/sentinel','foreign',{mode:0o600});throw Error('SYNTHETIC_PRIVATE_FAILURE');
}`;
  writeFileSync(join(codeRoot, 'runtime.mjs'), source);
  writeFileSync(join(codeRoot, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1,
    revision: 'b1b0f10952a59eb59f7358bd681a3cdc94d9b61c', sha256: createHash('sha256').update(source).digest('hex') }));
  replay = await adapter.openReplay({ codeRoot, stateRoot, config, initial });
  await assert.rejects(replay.restore({ artifact: new Uint8Array(), recoveryKey: 'synthetic-key' }),
    e => e.message === 'Invalid cloud cost replay runtime' && !e.stack.includes('SYNTHETIC_PRIVATE_FAILURE'));
  assert.equal(existsSync(join(stateRoot, 'restored-original')), true);
  assert.equal(existsSync(join(stateRoot, 'restored/sentinel')), true, 'cleanup must preserve the replacement');
  assert.equal(readFileSync(join(stateRoot, 'restored/sentinel'), 'utf8'), 'foreign');
});

test('archiveOptionsRefuseExtraFieldsBeforeWriting', async t => {
  const { replay, stateRoot } = await archiveFixture(t);
  const options = { recoveryKey: 'synthetic-key', at: new Date(), signal: new AbortController().signal };
  const { existsSync } = await import('node:fs');
  await assert.rejects(replay.capture({ ...options, payload: 'SYNTHETIC_PRIVATE_CANARY' }), /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(join(stateRoot, 'cloud-snapshots')), false);
  const capture = await replay.capture(options);
  await assert.rejects(replay.restore({ artifact: capture.bytes, recoveryKey: 'synthetic-key', payload: 'SYNTHETIC_PRIVATE_CANARY' }),
    /Invalid cloud cost replay runtime/);
  assert.equal(existsSync(join(stateRoot, 'restored')), false);
});

// The asset is read beside the actual prepared bundle, not from the test fixture.
test('replayBundleCarriesMatchingReleaseAndFont',()=>{
 const manifest=JSON.parse(readFileSync(join(fixture.codeRoot,'runtime-manifest.json'),'utf8'));
 assert.equal(manifest.revision,'b1b0f10952a59eb59f7358bd681a3cdc94d9b61c');
 assert.equal(manifest.sha256,createHash('sha256').update(readFileSync(join(fixture.codeRoot,'runtime.mjs'))).digest('hex'));
 assert.equal(createHash('sha256').update(readFileSync(join(fixture.codeRoot,'assets/invoice-noto-sans.ttf'))).digest('hex'),
  'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d');
});

test('setupUsesModuleOwnedAllocation',async t=>{
 const {stateRoot}=await open(t);
 const db=new DatabaseSync(join(stateRoot,'venue/venue.db'),{readOnly:true});
 try {
  const node=readFileSync(join(stateRoot,'trading.env'),'utf8').match(/^WAITRON_NODE_ID=([^\n]+)\n$/)?.[1];
  assert.ok(node);
  const allocations=db.prepare('SELECT * FROM fiscal_allocations').all();
  assert.equal(allocations.length,1,'ordinary provisioning must retain its actual allocation');
  const a=allocations[0],input=JSON.parse(a.allocation);
  assert.equal(a.node_id,node);assert.equal(a.software_id,'W1');assert.equal(a.environment,'preproduction');
  assert.equal(input.source,'hour');assert.equal(input.installationIdentity,a.installation_identity);
  assert.match(a.installation_identity,/^[0-9A-HJKMNP-TV-Z]{5}$/);
  const series=db.prepare('SELECT id,node_id,code,purpose,next_number,retired_at FROM invoice_series ORDER BY purpose').all();
  assert.equal(series.length,3);
  assert.deepEqual(series.map(row=>({node:row.node_id,purpose:row.purpose,code:row.code,next:row.next_number,retired:row.retired_at})),[
   {node,purpose:'full',code:'F-'+a.installation_identity,next:1,retired:null},
   {node,purpose:'rectificative',code:'C-'+a.installation_identity,next:1,retired:null},
   {node,purpose:'standard',code:'R-'+a.installation_identity,next:1,retired:null},
  ]);
  assert.equal(new Set(series.map(row=>row.id)).size,3);
  const sif=db.prepare('SELECT * FROM registro_sif').all();assert.equal(sif.length,1);
  assert.equal(sif[0].id,a.sif_id);assert.equal(sif[0].node_id,node);
  assert.equal(sif[0].id_sistema_informatico,'W1');assert.equal(sif[0].numero_instalacion,a.installation_identity);
  assert.equal(db.prepare('SELECT name FROM nodes WHERE id=?').get(node).name,'Synthetic node');
 } finally {db.close();}
});

// Execute the peer's actual provisioning prefix with private host paths. HTTPS routes are qualified separately.
test('ownerPeerProvisioningRetainsRealAllocation',async t=>{
 const {spawnSync}=await import('node:child_process');
 const {pathToFileURL}=await import('node:url');
 const owner=JSON.parse(readFileSync(process.env.COST_OWNER_FIXTURE,'utf8'));
 const root=mkdtempSync(join(fixture.stateParent,'owner-provision-'));chmodSync(root,0o700);
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const backend=readFileSync(new URL('./remote-waitron-backend.mjs',import.meta.url),'utf8');
 const prefix=backend.slice(0,backend.indexOf('const app = new r.Hono();'))
  .replace("'/input/runtime.mjs'",JSON.stringify(pathToFileURL(owner.runtime).href))
  .replace("'/input/migrations/manifest.json'",JSON.stringify(join(owner.migrations,'manifest.json')))
  .replace("'/input/migrations/'",JSON.stringify(owner.migrations+'/'))
  .replaceAll("'/tmp/venue'",JSON.stringify(join(root,'venue')))
  .replace("stateDir: '/tmp'",'stateDir: '+JSON.stringify(root));
 assert.equal(prefix.includes("'/tmp"),false,'every peer scratch path must be redirected before execution');
 const summary="console.log(JSON.stringify({node:provisioned.nodeId,rows:(await store.venue.execute(r.sql`SELECT node_id,software_id,environment FROM fiscal_allocations`)).rows}));await store.close();";
 const result=spawnSync(process.execPath,['--input-type=module','-e',prefix+summary],{encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(result.stdout);assert.equal(data.rows.length,1);
 assert.deepEqual(data.rows,[{node_id:data.node,software_id:'W1',environment:'preproduction'}]);
});
