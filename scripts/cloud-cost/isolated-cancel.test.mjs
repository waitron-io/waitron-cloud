import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Even an image-inspection subprocess must not run for a pre-cancelled request.
test('anAlreadyCancelledReplayRefusesBeforeAnyExternalCommandOrJournalWrite', t => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cost-pre-cancel-'))), source = join(parent, 'source'), root = join(parent, 'owned'), bin = join(parent, 'bin');
  for (const path of [source, root, bin]) mkdirSync(path, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { token, path: join(root, 'journal.json') }, codeRoot = join(root, 'code');
  mkdirSync(codeRoot, { mode: 0o700 });
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  const runtime = 'export const synthetic=true;'; writeFileSync(join(codeRoot, 'runtime.mjs'), runtime);
  writeFileSync(join(codeRoot, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1,
    revision: 'fbadd15785464e59747e697c11048bfbc6e4938f', sha256: createHash('sha256').update(runtime).digest('hex') }));
  const database = join(source, 'venue.db'); writeFileSync(database, 'Synthetic input must not be opened');
  const marker = join(parent, 'external-command');
  const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf touched > ' + quote(marker) + '\nexit 7\n', { mode: 0o700 });
  t.after(() => rmSync(parent, { recursive: true }));
  const f = { source, root, journal, database, codeRoot, image: 'sha256:' + 'a'.repeat(64), locationId: 'synthetic', windowSeconds: 120, replayWindowSeconds: 10,
    expected: { sales: 4, paid: 4, tradingDays: 2, busiest: 3 }, originalInventory: { timeZone: 'Europe/Madrid', days: 2, busiest: 3 },
    cadence: { mode: 'accelerated', factor: 100 }, initial: {},
    config: { localEndpoints: { s3: 'http://s3:8333', postgres: 'postgresql://fixture:fixture@postgres:5432/fixture', smtp: 'smtp://mailpit:1025', fiscal: 'http://fiscal:8080', gateway: 'https://gateway:443' },
      senders: { fiscal: 'disabled', mail: 'capture', acme: 'disabled', dns: 'disabled' } } };
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';import fs from 'node:fs';
    import {runIsolatedReplay} from ${JSON.stringify(new URL('./isolated-replay.mjs', import.meta.url).href)};
    const f=JSON.parse(process.argv[1]),before=fs.readFileSync(f.journal.path,'utf8'),abort=new AbortController();abort.abort();
    await assert.rejects(runIsolatedReplay({...f,signal:abort.signal}),{message:'Invalid isolated cloud cost replay'});
    assert.equal(fs.existsSync(process.argv[2]),false,'a cancelled request cannot dispatch an external command');
    assert.equal(fs.readFileSync(f.journal.path,'utf8'),before);
  `, JSON.stringify(f), marker], { encoding: 'utf8', timeout: 10000, env: { PATH: bin + ':' + process.env.PATH, LANG: 'C', TZ: 'UTC' } });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
});
