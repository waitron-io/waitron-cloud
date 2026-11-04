// This fixture consumes the paired archive; it never seeds or substitutes a source database.
import {it, expect, vi, afterEach} from 'vitest';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ALL_MODULES} from '@waitron/composition';
import {openVenueDatabase} from '@waitron/db';
import {createFirstSetupCoordinator} from '@waitron/provisioning';
import {parseEnvFile} from './env-file.js';
import {verifyBreakGlass} from './break-glass.js';
import {previewRecoveryArchive} from './recovery-backup-preview.js';
import {createInteractiveRecoveryPreparation} from './recovery-preparation.js';
import {validateArtifact, restoreFromArtifact} from './restore.js';
import {createRecoveryRestoreRunner} from './recovery-module-operation.js';
import {runRestore} from './restore-command.js';
import {decodeHourIdentity} from '../../../packages/fiscal-verifactu/src/hour-identity.js';

// Source tests receive the same generated commit stamp that the pinned release embeds at build time.
await vi.hoisted(async () => {
  const {readFileSync} = await import('node:fs');
  vi.stubGlobal('__WAITRON_HOUR_RELEASE__', JSON.parse(readFileSync('/waitron/build/hour-release.json', 'utf8')));
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

// The isolated fixture supplies a local clock observation; it never contacts an outside clock.
vi.mock('@waitron/fiscal-verifactu/src/hour-clock-internet.js', () => ({
  observeInternetHourClock: async () => ({source: 'internet', result: 'usable', instantMs: Date.now(),
    uncertaintyMs: 0, wallStartedMs: Date.now(), wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(), monotonicFinishedMs: performance.now()}),
}));

it('prepares ordinary recovery for the privately delivered paired source and preserves its records', async () => {
  const input = JSON.parse(await readFile('/tmp/cloud-integration-authorised-input.json', 'utf8'));
  const artifact = Buffer.from(input.delivery.archive, 'base64');
  const sha256 = createHash('sha256').update(artifact).digest('hex');
  expect(sha256).toBe(input.sha256); expect(input.delivery.digest).toBe(sha256);
  expect(artifact.length).toBe(input.bytes);
  const root = await mkdtemp('/tmp/cloud-integration-authorised-');
  try {
    const stateDir = join(root, 'state'), venueDir = join(root, 'venue');
    await mkdir(stateDir); await mkdir(venueDir);
    const restore = {artifact, recoveryKey: input.delivery.recoveryKey, stateDir, venueDir,
      stagingDir: root, modules: ALL_MODULES, migrationsRoot: '/waitron/apps/server/dist/drizzle',
      environment: 'preproduction' as const, log: () => {}};
    const selected = await previewRecoveryArchive(restore);
    expect(selected.nodeId).toBe(input.authority.sourceNodeId);
    expect(selected.nodeRecoveryKeyName).toBe(input.authority.name);
    const copy = await validateArtifact(restore);
    const tables = ['sales', 'sale_lines', 'tenders', 'sale_settlements', 'registros_facturacion', 'envios'];
    const records = (path: string) => {
      const db = new DatabaseSync(path, {readOnly: true});
      try {return tables.map(table => ({table, rows: db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()}));}
      finally {db.close();}
    };
    let originalRecords;
    let outcome: {input: unknown};
    const binding = {module: 'fiscal-verifactu', action: 'restore', eventId: randomUUID(),
      sourceId: selected.sourceId, targetNodeId: selected.nodeId};
    try {
      originalRecords = records(copy.databasePath);
      const recorded = new DatabaseSync(copy.databasePath, {readOnly: true});
      let installationCodes: string[];
      try {installationCodes = recorded.prepare('SELECT numero_instalacion FROM registro_sif WHERE node_id=?').all(selected.nodeId).map(row => String(row.numero_instalacion));}
      finally {recorded.close();}
      expect(installationCodes.length).toBeGreaterThan(0);
      const sourceHour = Date.parse('2026-01-01T00:00:00Z') + Math.max(...installationCodes.map(decodeHourIdentity)) * 3600000;
      vi.useFakeTimers({toFake: ['Date', 'performance']});
      vi.setSystemTime(new Date(sourceHour + 30 * 60 * 1000));
      const source = await openVenueDatabase(dirname(copy.databasePath));
      try {expect(await verifyBreakGlass(source.venue, selected.nodeId, input.authority.secret)).toBe(true);}
      finally {await source.close();}
      const service = createInteractiveRecoveryPreparation({stateDir, venueDir, migrationsRoot: restore.migrationsRoot,
        modules: ALL_MODULES, coordinator: createFirstSetupCoordinator()});
      const prepare = (proposal: unknown) => service.prepare(copy, selected.sourceId, {binding,
        context: {selectedSourceId: selected.sourceId, oldBoxGone: true, soleRecovery: true},
        nodeRecoverySecret: input.authority.secret, proposal});
      const compare = async () => {
        const challenge = await prepare({action: 'clock-challenge'}) as {id: string};
        await prepare({action: 'compare-clocks', browser: {challengeId: challenge.id, instantMs: Date.now()}});
      };
      await compare();
      await expect(prepare({action: 'select', answer: 'no', installationCodes})).rejects.toMatchObject({code: 'sif.allocation_invalid', params: {reason: 'hour_not_later'}});
      // The real guard requires a later hour; only this isolated target's clock advances.
      vi.setSystemTime(new Date(sourceHour + 90 * 60 * 1000));
      await compare();
      outcome = await prepare({action: 'select', answer: 'no', installationCodes}) as {input: unknown};
      expect(outcome.input).toBeDefined();
    } finally {await copy.discard();}
    const artifactPath = join(root, 'delivered.enc'), operationPath = join(root, 'operation.json');
    await writeFile(artifactPath, artifact, {mode: 0o600});
    await writeFile(operationPath, JSON.stringify({binding, input: outcome!.input}), {mode: 0o600});
    const env = {WAITRON_ENV: 'dev', WAITRON_STATE_DIR: stateDir, WAITRON_VENUE_DIR: venueDir,
      WAITRON_MIGRATIONS_DIR: restore.migrationsRoot, WAITRON_BACKUP_RECOVERY_KEY: input.delivery.recoveryKey,
      WAITRON_RECOVERY_OPERATION_FILE: operationPath, WAITRON_NODE_RECOVERY_KEY: input.authority.secret};
    const argv = ['restore', artifactPath, '--confirm-old-box-gone', '--confirm-sole-recovery'];
    let wrongOutput = '';
    expect(await runRestore({argv, env: {...env, WAITRON_NODE_RECOVERY_KEY: 'wrong node key'}, out: line => {wrongOutput += line;}})).toBe(1);
    expect(wrongOutput.includes('promotion.break_glass_invalid')).toBe(true);
    let denied: {code?: string; params?: {reason?: string}} | undefined;
    try {await restoreFromArtifact({...restore, withModuleOperations: createRecoveryRestoreRunner(ALL_MODULES, {binding, input: outcome!.input}, input.authority.secret)});}
    catch (error) {denied = error as typeof denied;}
    expect(denied?.code).toBe('sif.allocation_invalid');
    expect(denied?.params?.reason).toBe('outside_confirmation_missing');
    await expect(stat(join(venueDir, 'venue.db'))).rejects.toMatchObject({code: 'ENOENT'});
    await expect(stat(join(stateDir, 'trading.env'))).rejects.toMatchObject({code: 'ENOENT'});
    let output = '';
    const exit = await runRestore({argv, env, out: line => {output += line + '\n';}});
    expect(exit, output.replaceAll(input.authority.secret, '[redacted]').replaceAll(input.delivery.recoveryKey, '[redacted]')).toBe(0);
    expect(output.includes('restored ' + artifactPath)).toBe(true);
    for (const secret of [input.authority.secret, input.delivery.recoveryKey]) expect(output.includes(secret)).toBe(false);
    expect(records(join(venueDir, 'venue.db'))).toEqual(originalRecords);
    const db = new DatabaseSync(join(venueDir, 'venue.db'), {readOnly: true});
    try {expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{'integrity_check': 'ok'}]);}
    finally {db.close();}
    const trading = parseEnvFile(await readFile(join(stateDir, 'trading.env'), 'utf8'));
    expect(trading.WAITRON_TILL_NODE_ID).toBe(input.authority.sourceNodeId);
    expect(trading.WAITRON_TILL_LOCATION_ID).toBe(input.authority.localVenueId);
    for (const name of ['cloud-connection.json', 'cloud-staff.key', 'ready.json']) await expect(stat(join(stateDir, name))).rejects.toMatchObject({code: 'ENOENT'});
    console.log('CLOUD_PAIRED_AUTHORISED_RECOVERY=' + JSON.stringify({exit, sha256, bytes: artifact.length,
      sourceNodeId: trading.WAITRON_TILL_NODE_ID, localVenueId: trading.WAITRON_TILL_LOCATION_ID,
      preparationBoundToDeliveredArchive: binding.sourceId === selected.sourceId, sourceAuthorityVerified: true,
      wrongAuthorityRefused: true, missingPreparationRefused: true, integrity: 'ok', sourceRecordsPreserved: true,
      noServerStarted: true, noCloudCredentials: true, cloudReportedRestored: false}));
  } finally {await rm(root, {recursive: true, force: true});}
}, 90000);
