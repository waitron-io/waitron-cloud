import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/status-page-rehearsal-cli.ts', import.meta.url));

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-status-rehearsal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'incident.json');
  writeFileSync(input, JSON.stringify({
    service: 'remote_access',
    impact: 'some',
    confirmedAt: '2026-11-22T10:00:00Z',
  }));
  return { input, destination: join(root, 'bundle') };
}

function run(input: string, destination: string) {
  return spawnSync(process.execPath, [cli, input, destination], { encoding: 'utf8', timeout: 5000 });
}

test('the local command writes an Investigating update in both languages', (t) => {
  const { input, destination } = fixture(t);
  const result = run(input, destination);
  assert.equal(result.status, 0, result.stderr);

  const english = readFileSync(join(destination, 'index.html'), 'utf8');
  const spanish = readFileSync(join(destination, 'es/index.html'), 'utf8');
  assert.match(english, /<h1>Investigating<\/h1>/);
  assert.match(spanish, /<h1>Investigando<\/h1>/);
  assert.match(english, /Updated: <time datetime="2026-11-22T10:00:00Z">/);
  assert.match(spanish, /Actualizado: <time datetime="2026-11-22T10:00:00Z">/);
});

test('the local command refuses an existing destination without changing its contents', (t) => {
  const { input, destination } = fixture(t);
  mkdirSync(destination);
  const existing = join(destination, 'index.html');
  writeFileSync(existing, 'Keep the previous update');

  const result = run(input, destination);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'Status update rehearsal failed. Check the input and use a new output directory.\n');
  assert.deepEqual(readdirSync(destination), ['index.html']);
  assert.equal(readFileSync(existing, 'utf8'), 'Keep the previous update');
});
