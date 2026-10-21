// Generated venue only. The pinned runtime owns provisioning, identity and routes.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import * as r from '/input/runtime.mjs';

const sets = JSON.parse(readFileSync('/input/migrations/manifest.json'));
await r.applyMigrations('/tmp/venue', sets.map(set => ({ migrationsFolder: '/input/migrations/' + set.name,
  migrationsTable: set.table, appendOnlyTables: set.appendOnlyTables })));
const store = await r.openVenueDatabase('/tmp/venue');
r.registerModulePermissions(r.ALL_MODULE_PERMISSIONS);
const provisioned = await r.provisionVenue({ ownerDb: store.venue,
  moduleConfig: r.venueModuleConfig({ overrides: new Map() }, 'ES-common'), database: 'generated-cost-venue', stateDir: '/tmp' },
{ environment: 'preproduction', venue: { country: 'ES', taxId: '73000001K', legalName: 'Generated SL',
  location: { name: 'Generated venue', fiscalTerritory: 'ES-common', invoiceLocales: ['es-ES'], operationDescription: 'Venta de prueba',
    addressLine1: 'Calle Mayor 1', addressLine2: null, postalCode: '28013', city: 'Madrid', province: 'Madrid',
    timeZone: 'Europe/Madrid', dayCutover: '05:00' }, seriesCode: 'A', rectificativeSeriesCode: 'R',
  admin: { displayName: 'Generated owner', pinHash: r.hashPin('1234'), passwordHash: r.hashPassword('Generated local password'),
    email: 'owner@example.test', locale: 'en-GB' } } });
const app = new r.Hono();
const management = r.mountManagementApi(app, { db: store.venue, cfg: { nodeId: provisioned.nodeId },
  secureCookies: true, rpId: 'staff.generated.example.test', origin: 'https://staff.generated.example.test',
  credentialKeyRing: { current: { version: 1, key: randomBytes(32) } } }, () => {});
r.mountCloudPublic(app, () => true);
const server = createServer({ key: readFileSync('/input/staff.key'), cert: readFileSync('/input/staff.pem') }, r.getRequestListener(app.fetch));
await new Promise(resolve => server.listen(8443, '127.0.0.1', resolve));
await import('/app/src/peer-cli.ts');
process.once('SIGTERM', async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await management.close(); await store.close(); process.exit(0);
});
