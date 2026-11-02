import {assertReplayBundle,assertReplayAssets} from './replay-release.mjs';

import { readFileSync, realpathSync, lstatSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const fail = () => { throw new Error('Invalid cloud cost replay configuration'); };
const requireThat = value => { if (!value) fail(); };
const exact = (value, keys) => {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  const actual = Reflect.ownKeys(value);
  requireThat(actual.length === keys.length && actual.every(k => keys.includes(k)
    && Object.getOwnPropertyDescriptor(value, k).get === undefined));
};
const endpoints = { s3: ['http:', 's3'], postgres: ['postgresql:', 'postgres'], smtp: ['smtp:', 'mailpit'],
  fiscal: ['http:', 'fiscal'], gateway: ['https:', 'gateway'] };
const senders = { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' };

export function validateReplayConfig(config) {
  try {
    exact(config, ['localEndpoints', 'senders']); exact(config.localEndpoints, Object.keys(endpoints));
    exact(config.senders, Object.keys(senders));
    for (const [key, [protocol, host]] of Object.entries(endpoints)) {
      const value = config.localEndpoints[key]; requireThat(typeof value === 'string');
      const url = new URL(value);
      requireThat(url.protocol === protocol && [host, '127.0.0.1', '[::1]'].includes(url.hostname));
      // Check the spelling too: URL normalization must not admit alternative loopback addresses.
      const authority = value.match(/^[a-z]+:\/\/([^/?#]+)/)?.[1]?.split('@').at(-1);
      requireThat(authority === `${url.hostname}${url.port ? ':' + url.port : protocol === 'https:' ? ':443' : ':80'}`
        || (protocol === 'https:' && authority === url.hostname));
      requireThat(!url.search && !url.hash);
      if (key === 'postgres') {
        requireThat(/^[a-z][a-z0-9_]{0,63}$/.test(url.pathname.slice(1)));
        requireThat(/^[A-Za-z0-9_-]{1,64}$/.test(url.username) && /^[A-Za-z0-9_-]{1,64}$/.test(url.password));
      } else requireThat(!url.username && !url.password && ['/', ''].includes(url.pathname));
      const port = Number(url.port || (protocol === 'https:' ? 443 : protocol === 'http:' ? 80 : 0));
      requireThat(Number.isInteger(port) && port > 0 && port <= 65535);
    }
    for (const key of Object.keys(senders)) requireThat(config.senders[key] === senders[key]);
    return structuredClone(config);
  } catch { fail(); }
}

const runtimeFail = () => { throw new Error('Invalid cloud cost replay runtime'); };
const contained = (root, path) => path === root || (!relative(root, path).startsWith('..') && !isAbsolute(relative(root, path)));
function directoryEntryExists(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function replayPaths(codeRoot, stateRoot, initial) {
  requireThat(isAbsolute(codeRoot) && isAbsolute(stateRoot) && realpathSync(codeRoot) === codeRoot && realpathSync(stateRoot) === stateRoot);
  requireThat(lstatSync(codeRoot).isDirectory() && lstatSync(stateRoot).isDirectory());
  requireThat(!contained(codeRoot, stateRoot) && !contained(stateRoot, codeRoot));
  requireThat((lstatSync(stateRoot).mode & 0o777) === 0o700);
  requireThat(!directoryEntryExists(join(stateRoot, 'venue')));
  exact(initial, ['taxpayer', 'location', 'nodeName', 'seriesCode', 'fullSeriesCode', 'rectificativeSeriesCode', 'idSistemaInformatico']);
  const hasDomicile = Object.hasOwn(initial.taxpayer, 'taxpayerDomicile');
  exact(initial.taxpayer, ['country', 'taxId', 'legalName', ...(hasDomicile ? ['taxpayerDomicile'] : [])]);
  if (hasDomicile) requireThat(typeof initial.taxpayer.taxpayerDomicile === 'string'
    && initial.taxpayer.taxpayerDomicile.trim().length > 0 && initial.taxpayer.taxpayerDomicile.length < 1024);
  exact(initial.location, ['name', 'invoiceLocales', 'operationDescription', 'timeZone', 'dayCutover']);
  requireThat(initial.taxpayer.country === 'ES');
  requireThat([initial.taxpayer.taxId, initial.taxpayer.legalName, initial.nodeName, initial.location.name,
    initial.location.operationDescription, initial.location.timeZone].every(v => typeof v === 'string' && v.length > 0 && v.length < 1024));
  requireThat(Array.isArray(initial.location.invoiceLocales) && initial.location.invoiceLocales.length >= 1
    && initial.location.invoiceLocales.length <= 2 && initial.location.invoiceLocales.every(v => typeof v === 'string' && /^[a-z]{2}$/.test(v)));
  requireThat(typeof initial.location.dayCutover === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(initial.location.dayCutover));
  requireThat([initial.seriesCode, initial.fullSeriesCode, initial.rectificativeSeriesCode].every(v => typeof v === 'string' && /^[A-Z0-9]{1,8}$/.test(v))
    && new Set([initial.seriesCode, initial.fullSeriesCode, initial.rectificativeSeriesCode]).size === 3);
  requireThat(initial.idSistemaInformatico === 'W1');
  const runtime = join(codeRoot, 'runtime.mjs'); const manifestPath = join(codeRoot, 'runtime-manifest.json');
  for (const path of [runtime, manifestPath]) {
    const s = lstatSync(path); requireThat(realpathSync(path) === path && s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  exact(manifest, ['schemaVersion', 'revision', 'sha256']);
  assertReplayBundle(manifest,readFileSync(runtime));
  assertReplayAssets(codeRoot);
  const sets = JSON.parse(readFileSync(join(codeRoot, 'packages/migrations/migrations.manifest.json'), 'utf8'));
  requireThat(Array.isArray(sets) && sets.length > 0);
  const migrations = sets.map(set => {
    exact(set, ['name', 'table', 'from', 'appendOnlyTables']);
    requireThat(typeof set.name === 'string' && /^[a-z][a-z-]*$/.test(set.name));
    requireThat(typeof set.table === 'string' && /^__drizzle_migrations_[a-z_]+$/.test(set.table));
    requireThat(typeof set.from === 'string' && /^\.\.\/[a-z][a-z-]*\/drizzle$/.test(set.from));
    const migrationsFolder = resolve(codeRoot, 'packages/migrations', set.from);
    requireThat(contained(codeRoot, migrationsFolder) && realpathSync(migrationsFolder) === migrationsFolder);
    requireThat(Array.isArray(set.appendOnlyTables) && set.appendOnlyTables.every(v => typeof v === 'string' && /^[a-z][a-z_]*$/.test(v)));
    return { migrationsFolder, migrationsTable: set.table, appendOnlyTables: [...set.appendOnlyTables] };
  });
  return { runtime, migrations, sets };
}

export async function openReplay({ codeRoot, stateRoot, config, initial }) {
  let store;
  try {
    validateReplayConfig(config);
    const { runtime, migrations, sets } = replayPaths(codeRoot, stateRoot, initial);
    const r = await import(pathToFileURL(runtime).href);
    await r.applyMigrations(join(stateRoot, 'venue'), migrations);
    store = await r.openVenueDatabase(join(stateRoot, 'venue'));
    const db = store.venue;
    r.registerModulePermissions(r.ALL_MODULE_PERMISSIONS);
    const provisioned = await r.provisionVenue({ ownerDb: db,
      moduleConfig: r.venueModuleConfig({ overrides: new Map() }, 'ES-common'),
      database: 'generated-cost-replay', stateDir: stateRoot }, {
      environment: 'preproduction', initialAllocation: { kind: 'throwaway', hostEnvironment: 'preproduction' },
      venue: { ...initial.taxpayer,
        location: { ...initial.location, fiscalTerritory: 'ES-common', addressLine1: 'Synthetic street 1',
          addressLine2: null, postalCode: '28013', city: 'Madrid', province: 'Madrid' },
        seriesCode: initial.seriesCode, fullSeriesCode: initial.fullSeriesCode,
        rectificativeSeriesCode: initial.rectificativeSeriesCode,
        admin: { displayName: 'Generated replay owner', pinHash: r.hashPin('1234'),
          passwordHash: r.hashPassword('Generated local replay password'), email: 'owner@example.test', locale: 'en-GB' },
      },
    }, r.ALL_MODULES);
    const nodeId = provisioned.nodeId;
    const series = (await db.execute(r.sql`SELECT id, node_id, code, purpose FROM invoice_series
      WHERE node_id=${nodeId} AND retired_at IS NULL`)).rows;
    const identities = (await db.execute(r.sql`SELECT numero_instalacion, id_sistema_informatico FROM registro_sif
      WHERE node_id=${nodeId} AND revocado_en IS NULL`)).rows;
    requireThat(identities.length === 1 && identities[0].id_sistema_informatico === initial.idSistemaInformatico);
    requireThat(series.length === 3 && new Set(series.map(row => row.id)).size === 3
      && provisioned.seriesIds.length === 3 && new Set(provisioned.seriesIds).size === 3
      && series.every(row => row.node_id === nodeId && provisioned.seriesIds.includes(row.id)));
    const selected = new Map();
    for (const [purpose, base] of [['standard', initial.seriesCode], ['full', initial.fullSeriesCode],
      ['rectificative', initial.rectificativeSeriesCode]]) {
      const matches = series.filter(row => row.purpose === purpose && row.code === `${base}-${identities[0].numero_instalacion}`);
      requireThat(matches.length === 1); selected.set(purpose, matches[0].id);
    }
    const standard = selected.get('standard'), full = selected.get('full');
    // Provisioning uses the venue label; replay retains its independently supplied node label.
    await db.execute(r.sql`UPDATE nodes SET name=${initial.nodeName} WHERE id=${nodeId}`);
    writeFileSync(join(stateRoot, 'trading.env'),
      `WAITRON_NODE_ID=${nodeId}\n`, { mode: 0o600, flag: 'wx' });
    const backend = new r.VerifactuBackend({ db, clock: { now: runtimeFail }, environment: 'preproduction',
      deploymentEnvironment: 'preproduction', resolveClient: async () => runtimeFail() });
    const stateIdentity = lstatSync(stateRoot);
    const validateState = () => {
      const s = lstatSync(stateRoot);
      requireThat(realpathSync(stateRoot) === stateRoot && s.ino === stateIdentity.ino
        && s.dev === stateIdentity.dev && (s.mode & 0o777) === 0o700);
      const scan = path => {
        for (const entry of readdirSync(path)) {
          const child = join(path, entry), info = lstatSync(child);
          requireThat(!info.isSymbolicLink() && (info.isDirectory() || (info.isFile() && info.nlink === 1)));
          if (info.isDirectory()) scan(child);
        }
      };
      scan(stateRoot);
    };
    let attempted = 0, successful = 0, failed = 0, closing = false, closePromise;
    let pending = Promise.resolve(), writerClose;
    let sourceClosed = false, nodeRecoverySecret;
    const captures = new Set();
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    const closeWriter = () => writerClose ??= store.close().then(() => { sourceClosed = true; });
    const admit = (action, recovery = false) => {
      if (closing && !recovery) return Promise.reject(new Error('Invalid cloud cost replay runtime'));
      const result = pending.then(action).catch(() => runtimeFail());
      pending = result.catch(() => {});
      return result;
    };
    const archiveModules = () => r.ALL_MODULES.map(m => {
      const index = sets.findIndex(s => s.name === m.name && s.table === m.migrations.table);
      requireThat(index >= 0);
      return { ...m, migrations: { ...m.migrations, from: migrations[index].migrationsFolder } };
    });
    return {
      recordSale(sale) {
        return admit(async () => {
          attempted++;
          try {
            requireThat(sale && typeof sale === 'object' && !('nodeId' in sale) && !('seriesId' in sale));
            const result = await r.withTransaction(db, tx => r.recordSale(tx, backend,
              { ...sale, nodeId, seriesId: sale.counterparty ? full : standard }));
            successful++;
            return result;
          } catch { failed++; runtimeFail(); }
        });
      },
      verify() {
        return admit(async () => {
          const result = await r.withTransaction(db, tx => backend.checkIntegrity(tx, nodeId));
          return { ok: result.ok, issues: result.issues.length };
        });
      },
      capture(options) {
        return admit(async () => {
          exact(options, ['recoveryKey', 'at', 'signal']);
          const { recoveryKey, at, signal } = options;
          requireThat(typeof recoveryKey === 'string' && recoveryKey.length > 0);
          validateState();
          nodeRecoverySecret ??= (await r.mintBreakGlassKey(db, nodeId)).secret;
          const captured = await r.createCloudSnapshotArchive({ db, modules: archiveModules(),
            environment: 'preproduction', stateDir: stateRoot }, recoveryKey, at, signal);
          captures.add(digest(captured.bytes));
          return captured;
        });
      },
      restore(options) {
        closing = true;
        return admit(async () => {
          exact(options, ['artifact', 'recoveryKey']);
          const { artifact, recoveryKey } = options;
          requireThat(typeof recoveryKey === 'string' && recoveryKey.length > 0);
          requireThat(artifact instanceof Uint8Array && captures.has(digest(artifact)));
          validateState();
          await closeWriter();
          const restoredRoot = join(stateRoot, 'restored');
          requireThat(!directoryEntryExists(restoredRoot));
          mkdirSync(restoredRoot, { mode: 0o700 });
          const restoredIdentity = lstatSync(restoredRoot);
          let inspection, inspected;
          try {
            const modules = archiveModules();
            const deps = { artifact, recoveryKey, stateDir: restoredRoot,
              stagingDir: join(restoredRoot, 'staging'), modules, migrationsRoot: null, environment: 'preproduction' };
            inspection = await r.validateArtifact(deps);
            const selected = await r.readRecoveryCopyPreview(inspection, inspection.sourceId, deps);
            const node = await r.readArtifactNode(inspection);
            requireThat(node.nodeId === nodeId && selected.nodeId === nodeId);
            inspected = await r.openVenueDatabase(dirname(inspection.databasePath));
            const binding = { module: 'fiscal-verifactu', action: 'restore', eventId: randomUUID(),
              sourceId: inspection.sourceId, targetNodeId: nodeId };
            const clock = r.replayClock;
            clock.advance(Math.max(120000, Date.now() + 120000 - clock.wall()));
            const service = r.createSelectedRecoveryPreparation({ stateDir: restoredRoot,
              venueDir: join(restoredRoot, 'venue'), coordinator: r.createFirstSetupCoordinator(),
              modules, binding, node, selected, secret: nodeRecoverySecret,
              database: () => inspected.venue, testClock: clock,
              readIsolation: async () => {
                requireThat(sourceClosed && writerClose !== undefined && closing);
                return { oldMachineOffline: true, oldMachineAbsent: false, noParallelRecovery: true };
              },
            });
            let prepared;
            for (let round = 0; round < 4; round++) {
              const client = { onBox: false };
              const challenge = await service.prepare({ action: 'clock-challenge' }, client);
              const compared = await service.prepare({ action: 'compare-clocks',
                browser: { challengeId: challenge.id, instantMs: clock.wall() } }, client);
              await service.prepare({ action: 'preview' }, client);
              prepared = await service.prepare({ action: 'select', comparisonId: compared.id }, client);
              if (prepared.status !== 'waiting') break;
              requireThat(Number.isSafeInteger(prepared.targetMs));
              clock.advance(Math.max(0, prepared.targetMs + 1 - clock.wall()));
            }
            requireThat(prepared.status === 'selected');
            const withModuleOperations = service.runner(prepared.input, { refresh: true });
            await inspected.close(); inspected = undefined;
            await r.restoreFromArtifact({ artifact, recoveryKey, stateDir: restoredRoot,
              stagingDir: join(restoredRoot, 'staging'), venueDir: join(restoredRoot, 'venue'),
              modules: service.modules, withModuleOperations, migrationsRoot: null, environment: 'preproduction', log: () => {} });
            const restored = await r.openVenueDatabase(join(restoredRoot, 'venue'));
            try {
              const restoredBackend = new r.VerifactuBackend({ db: restored.venue, clock: { now: runtimeFail },
                environment: 'preproduction', deploymentEnvironment: 'preproduction', resolveClient: async () => runtimeFail() });
              const integrity = await r.withTransaction(restored.venue, tx => restoredBackend.checkIntegrity(tx, nodeId));
              const sales = await restored.venue.execute(r.sql`select count(*) as n from sales`);
              return { ok: integrity.ok, issues: integrity.issues.length, sales: Number(sales.rows[0].n) };
            } finally { await restored.close(); }
          } catch (error) {
            try { await inspected?.close(); } finally { inspected = undefined; }
            await inspection?.discard(); inspection = undefined;
            validateState();
            const s = lstatSync(restoredRoot);
            requireThat(s.ino === restoredIdentity.ino && s.dev === restoredIdentity.dev);
            rmSync(restoredRoot, { recursive: true });
            throw error;
          } finally {
            try { await inspected?.close(); } finally { await inspection?.discard(); }
          }
        }, true);
      },
      counts: () => ({ attempted, successful, failed }),
      close() {
        closing = true;
        closePromise ??= pending.then(closeWriter).catch(() => runtimeFail());
        return closePromise;
      },
    };
  } catch {
    try { await store?.close(); } catch { /* Preserve the generic refusal without private exception text. */ }
    runtimeFail();
  }
}
