
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

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
  exact(initial, ['taxpayer', 'location', 'nodeName', 'seriesCode', 'fullSeriesCode', 'idSistemaInformatico']);
  exact(initial.taxpayer, ['country', 'taxId', 'legalName']);
  exact(initial.location, ['name', 'invoiceLocales', 'operationDescription', 'timeZone', 'dayCutover']);
  requireThat(initial.taxpayer.country === 'ES');
  requireThat([initial.taxpayer.taxId, initial.taxpayer.legalName, initial.nodeName, initial.location.name,
    initial.location.operationDescription, initial.location.timeZone].every(v => typeof v === 'string' && v.length > 0 && v.length < 1024));
  requireThat(Array.isArray(initial.location.invoiceLocales) && initial.location.invoiceLocales.length >= 1
    && initial.location.invoiceLocales.length <= 2 && initial.location.invoiceLocales.every(v => typeof v === 'string' && /^[a-z]{2}$/.test(v)));
  requireThat(typeof initial.location.dayCutover === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(initial.location.dayCutover));
  requireThat([initial.seriesCode, initial.fullSeriesCode].every(v => typeof v === 'string' && /^[A-Z0-9]{1,8}$/.test(v))
    && initial.seriesCode !== initial.fullSeriesCode);
  requireThat(typeof initial.idSistemaInformatico === 'string' && /^[A-Z0-9]{1,2}$/.test(initial.idSistemaInformatico));
  const runtime = join(codeRoot, 'runtime.mjs'); const manifestPath = join(codeRoot, 'runtime-manifest.json');
  for (const path of [runtime, manifestPath]) {
    const s = lstatSync(path); requireThat(realpathSync(path) === path && s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  exact(manifest, ['schemaVersion', 'revision', 'sha256']);
  requireThat(manifest.schemaVersion === 1 && manifest.revision === 'fbadd15785464e59747e697c11048bfbc6e4938f');
  requireThat(manifest.sha256 === createHash('sha256').update(readFileSync(runtime)).digest('hex'));
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
  return { runtime, migrations };
}

export async function openReplay({ codeRoot, stateRoot, config, initial }) {
  let store;
  try {
    validateReplayConfig(config);
    const { runtime, migrations } = replayPaths(codeRoot, stateRoot, initial);
    const r = await import(pathToFileURL(runtime).href);
    await r.applyMigrations(join(stateRoot, 'venue'), migrations);
    store = await r.openVenueDatabase(join(stateRoot, 'venue'));
    const db = store.venue;
    const { nodeId, standard, full } = await r.withTransaction(db, async tx => {
      await tx.insert(r.tenants).values({ id: 1, ...initial.taxpayer });
      const [location] = await tx.insert(r.locations).values(initial.location).returning({ id: r.locations.id });
      const [node] = await tx.insert(r.nodes).values({ locationId: location.id, name: initial.nodeName }).returning({ id: r.nodes.id });
      const [standard] = await tx.insert(r.invoiceSeries).values({ nodeId: node.id, code: initial.seriesCode }).returning({ id: r.invoiceSeries.id });
      const [full] = await tx.insert(r.invoiceSeries).values({ nodeId: node.id, code: initial.fullSeriesCode, purpose: 'full' }).returning({ id: r.invoiceSeries.id });
      await r.registerSif(tx, { nodeId: node.id, nif: initial.taxpayer.taxId, idSistemaInformatico: initial.idSistemaInformatico });
      return { nodeId: node.id, standard: standard.id, full: full.id };
    });
    const backend = new r.VerifactuBackend({ db, clock: { now: runtimeFail }, environment: 'preproduction',
      deploymentEnvironment: 'preproduction', resolveClient: async () => runtimeFail() });
    let attempted = 0, successful = 0, failed = 0, closing = false, closePromise;
    let pending = Promise.resolve();
    const admit = action => {
      if (closing) return Promise.reject(new Error('Invalid cloud cost replay runtime'));
      const result = pending.then(action).catch(() => runtimeFail());
      pending = result.catch(() => {});
      return result;
    };
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
      counts: () => ({ attempted, successful, failed }),
      close() {
        closing = true;
        closePromise ??= pending.then(() => store.close()).catch(() => runtimeFail());
        return closePromise;
      },
    };
  } catch {
    try { await store?.close(); } catch { /* Preserve the generic refusal without private exception text. */ }
    runtimeFail();
  }
}
