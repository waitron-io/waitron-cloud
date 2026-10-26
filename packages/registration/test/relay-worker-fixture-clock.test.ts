import assert from 'node:assert/strict';
import {randomBytes, generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import {createLeaseIssuer} from '../src/installation-proof.ts';
import {RelayBounds, type RelayBoundsConfig} from '../src/relay-bounds.ts';

// Execute the fixture's actual initialization with only PostgreSQL replaced.
// Keep the window calculation in RelayBounds so a fixed calendar epoch fails here.
async function configuration(databaseTime: number, applicationTime: number): Promise<RelayBoundsConfig> {
  const source = readFileSync(new URL('./fixtures/relay-worker.ts', import.meta.url), 'utf8');
  const start = source.indexOf(' const issuer=');
  const end = source.indexOf(' const config=');
  assert.ok(start > 0 && end > start, 'fixture configuration block must be present');
  const body = stripTypeScriptTypes(source.slice(start, end)) + '\nreturn relay.bounds;';
  const construct = new (Object.getPrototypeOf(async function () {}).constructor)(
    'pool', 'Date', 'randomBytes', 'generateKeyPairSync', 'createLeaseIssuer', body);
  class ApplicationDate extends Date {static now() {return applicationTime;}}
  return construct({async query(sql: string) {
    assert.equal(sql, 'SELECT clock_timestamp() AS now');
    return {rows: [{now: new Date(databaseTime)}]};
  }}, ApplicationDate, randomBytes, generateKeyPairSync, createLeaseIssuer);
}

// Counter storage is empty; every clock observation comes from the database.
async function reserve(config: RelayBoundsConfig, time: number) {
  const client = {async query(sql: string) {
    if (sql === 'SELECT clock_timestamp() AS now') return {rows: [{now: new Date(time)}]};
    if (sql.startsWith('SELECT 1 FROM relay_bounds_policy')) return {rowCount: 1, rows: [{}]};
    if (sql.startsWith('SELECT (SELECT count(*)')) return {rows: [{count: '0'}]};
    return {rows: [], rowCount: 0};
  }};
  return new RelayBounds({} as any, config).reserve(client as any, {
    grantId: 'b33fc552-389f-462a-a7e6-94c112343994', recipient: 'ana@example.test',
  });
}

for (const [label, setup, admission, finish, expectedEnd] of [
  ['last millisecond', '2026-10-26T03:59:59.999Z', '2026-10-26T03:59:59.999Z', '2026-10-26T04:00:00.001Z', '2026-10-26T04:59:59.999Z'],
  ['exact hour', '2026-10-26T04:00:00.000Z', '2026-10-26T04:00:00.000Z', '2026-10-26T04:00:00.002Z', '2026-10-26T05:00:00.000Z'],
  ['setup crosses hour', '2026-10-26T03:59:59.999Z', '2026-10-26T04:00:00.001Z', '2026-10-26T04:00:00.003Z', '2026-10-26T04:59:59.999Z'],
] as const) for (const applicationOffset of [-7200000, 0, 7200000]) {
  test(`worker fixture counter stays live at ${label} with application offset ${applicationOffset}`, async () => {
    const config = await configuration(Date.parse(setup), Date.parse(setup) + applicationOffset);
    const end = await reserve(config, Date.parse(admission));
    assert.ok(end.getTime() > Date.parse(finish), 'counter must remain live through final admission');
    assert.equal(end.toISOString(), expectedEnd, 'one-hour window starts at fixture database time');
  });
}
