// The kit and source authority stay in this disposable target; only measured results leave it.
import {it, expect, vi, afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {ALL_MODULES} from '@waitron/composition';
import {openVenueDatabase} from '@waitron/db';
import {createFirstSetupCoordinator} from '@waitron/provisioning';
import {parseRecoveryKit} from '@waitron/stream';
import {parseEnvFile} from './env-file.js';
import {verifyBreakGlass} from './break-glass.js';
import {createInteractiveRecoveryPreparation} from './recovery-preparation.js';
import {validateDatabaseEntries} from './restore.js';
import {prepareStreamRestore, restoreFromStream} from './restore-stream.js';
import {runRestore} from './restore-command.js';
import {decodeHourIdentity} from '../../../packages/fiscal-verifactu/src/hour-identity.js';
import {REBUILD_MARKER} from './rebuild-first-start.js';

await vi.hoisted(async () => {
  const {readFileSync} = await import('node:fs');
  vi.stubGlobal('__WAITRON_HOUR_RELEASE__', JSON.parse(readFileSync('/waitron/build/hour-release.json', 'utf8')));
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
vi.mock('@waitron/fiscal-verifactu/src/hour-clock-internet.js', () => ({
  observeInternetHourClock: async () => ({source: 'internet', result: 'usable', instantMs: Date.now(),
    uncertaintyMs: 0, wallStartedMs: Date.now(), wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(), monotonicFinishedMs: performance.now()}),
}));

it('restores the native paired stream using its owner-approved kit and separate source authority', async () => {
  const input = JSON.parse(await readFile('/tmp/cloud-integration-stream-input.json', 'utf8'));
  const kit = parseRecoveryKit(input.kit);
  expect(kit.venueId).toBe(input.selected.localVenueId);
  const root = await mkdtemp('/tmp/cloud-integration-stream-restore-');
  try {
    const stateDir = join(root, 'state'), venueDir = join(root, 'venue');
    await mkdir(stateDir); await mkdir(venueDir);
    const restore = {kit, stateDir, venueDir, stagingDir: root, modules: ALL_MODULES,
      migrationsRoot: '/waitron/apps/server/dist/drizzle', environment: 'preproduction' as const,
      oldBoxGone: true, now: () => new Date(), litestreamBin: '/usr/local/bin/litestream', log: () => {}};
    const prepared = await prepareStreamRestore(restore);
    expect(prepared.nodeId).toBe(input.selected.sourceNodeId);
    expect(prepared.nodeId).toBe(input.authority.sourceNodeId);
    expect(prepared.generation).toBe(input.selected.generation);
    expect(prepared.venue.taxId).not.toBe('');
    const taxId = prepared.venue.taxId;
    const sourceId = 'stream:' + kit.venueId + ':' + prepared.generation;
    const tables = ['sales', 'sale_lines', 'tenders', 'sale_settlements', 'registros_facturacion', 'envios'];
    const records = (path: string) => {
      const db = new DatabaseSync(path, {readOnly: true});
      try {return tables.map(table => ({table, rows: db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()}));}
      finally {db.close();}
    };
    const originalRecords = records(prepared.databasePath);
    let operation;
    try {
      const copy = await validateDatabaseEntries(prepared.entries, prepared.databasePath, restore);
      try {
        const binding = {module: 'fiscal-verifactu', action: 'restore', eventId: randomUUID(),
          sourceId: copy.sourceId!, targetNodeId: prepared.nodeId};
        const source = await openVenueDatabase(dirname(copy.databasePath));
        try {expect(await verifyBreakGlass(source.venue, prepared.nodeId, input.authority.secret)).toBe(true);}
        finally {await source.close();}
        const db = new DatabaseSync(copy.databasePath, {readOnly: true});
        let installationCodes: string[];
        try {installationCodes = db.prepare('SELECT numero_instalacion FROM registro_sif WHERE node_id=?').all(prepared.nodeId).map(row => String(row.numero_instalacion));}
        finally {db.close();}
        expect(installationCodes.length).toBeGreaterThan(0);
        const sourceHour = Date.parse('2026-01-01T00:00:00Z') + Math.max(...installationCodes.map(decodeHourIdentity)) * 3600000;
        // Only the isolated recovery target advances; the native source and host clocks stay real.
        vi.useFakeTimers({toFake: ['Date', 'performance']});
        vi.setSystemTime(new Date(sourceHour + 90 * 60 * 1000));
        const service = createInteractiveRecoveryPreparation({stateDir, venueDir, migrationsRoot: restore.migrationsRoot,
          modules: ALL_MODULES, coordinator: createFirstSetupCoordinator()});
        const prepare = (proposal: unknown) => service.prepare(copy, sourceId, {binding,
          context: {selectedSourceId: sourceId, oldBoxGone: true, soleRecovery: true},
          nodeRecoverySecret: input.authority.secret, proposal});
        const challenge = await prepare({action: 'clock-challenge'}) as {id: string};
        await prepare({action: 'compare-clocks', browser: {challengeId: challenge.id, instantMs: Date.now()}});
        const outcome = await prepare({action: 'select', answer: 'no', installationCodes}) as {input: unknown};
        expect(outcome.input).toBeDefined(); operation = {binding, input: outcome.input};
      } finally {await copy.discard();}
    } finally {await prepared.discard();}
    await expect(restoreFromStream({...restore, confirmVenue: () => true})).rejects.toMatchObject({code: 'restore.hook_failed', params: {module: 'fiscal-verifactu', code: 'sif.allocation_invalid'}});
    const absent = async (name: string) => {
      try {await stat(join(stateDir, name)); return false;}
      catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error;}
    };
    console.log('CLOUD_CONTINUOUS_REFUSAL_STATE=' + JSON.stringify({
      sourceRecordsPreserved: isDeepStrictEqual(records(join(venueDir, 'venue.db')), originalRecords),
      tradingIdentityAbsent: await absent('trading.env'), rebuildMarkerAbsent: await absent(REBUILD_MARKER),
      cloudConnectionAbsent: await absent('cloud-connection.json'), readyAbsent: await absent('ready.json'),
    }));
    await expect(stat(join(venueDir, 'venue.db'))).rejects.toMatchObject({code: 'ENOENT'});
    await expect(stat(join(stateDir, 'trading.env'))).rejects.toMatchObject({code: 'ENOENT'});
    const kitPath = join(root, 'kit.txt'), operationPath = join(root, 'operation.json');
    await writeFile(kitPath, input.kit, {mode: 0o600});
    await writeFile(operationPath, JSON.stringify(operation), {mode: 0o600});
    const env = {WAITRON_ENV: 'dev', WAITRON_STATE_DIR: stateDir, WAITRON_VENUE_DIR: venueDir,
      WAITRON_MIGRATIONS_DIR: restore.migrationsRoot, WAITRON_LITESTREAM_BIN: restore.litestreamBin,
      WAITRON_RECOVERY_OPERATION_FILE: operationPath, WAITRON_NODE_RECOVERY_KEY: input.authority.secret};
    const argv = ['restore', '--from-bucket', kitPath, '--confirm-venue', taxId, '--confirm-old-box-gone', '--confirm-sole-recovery'];
    let wrongOutput = '';
    expect(await runRestore({argv, env: {...env, WAITRON_NODE_RECOVERY_KEY: 'wrong node key'}, out: line => {wrongOutput += line;}})).toBe(1);
    expect(wrongOutput.includes('promotion.break_glass_invalid')).toBe(true);
    let output = '';
    const exit = await runRestore({argv, env, out: line => {output += line + '\n';}});
    const safe = [input.kit, input.authority.secret, kit.recoveryKey, kit.bucket.secretAccessKey].reduce((text, secret) => text.replaceAll(secret, '[redacted]'), output);
    expect(exit, safe).toBe(0);
    expect(output.includes('restored from the bucket named in ' + kitPath)).toBe(true);
    for (const secret of [input.kit, input.authority.secret, kit.recoveryKey, kit.bucket.secretAccessKey]) expect(output.includes(secret)).toBe(false);
    expect(records(join(venueDir, 'venue.db'))).toEqual(originalRecords);
    const db = new DatabaseSync(join(venueDir, 'venue.db'), {readOnly: true});
    try {expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{'integrity_check': 'ok'}]);}
    finally {db.close();}
    const trading = parseEnvFile(await readFile(join(stateDir, 'trading.env'), 'utf8'));
    expect(trading.WAITRON_TILL_NODE_ID).toBe(input.selected.sourceNodeId);
    expect(trading.WAITRON_TILL_LOCATION_ID).toBe(input.selected.localVenueId);
    for (const name of ['cloud-connection.json', 'cloud-staff.key', 'ready.json']) await expect(stat(join(stateDir, name))).rejects.toMatchObject({code: 'ENOENT'});
    console.log('CLOUD_PAIRED_CONTINUOUS_RECOVERY=' + JSON.stringify({exit, sourceNodeId: trading.WAITRON_TILL_NODE_ID,
      localVenueId: trading.WAITRON_TILL_LOCATION_ID, generation: input.selected.generation, nativeRestore: true,
      sourceAuthorityVerified: true, preparationBoundToStream: true, sourceRecordsPreserved: true,
      wrongAuthorityRefused: true, missingPreparationRefused: true, noServerStarted: true, integrity: 'ok', cloudReportedRestored: false}));
  } finally {await rm(root, {recursive: true, force: true});}
}, 90000);
