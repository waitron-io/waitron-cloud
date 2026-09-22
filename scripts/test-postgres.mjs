import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Each run owns its container and random loopback port; no developer database is reset.
const name = `waitron-cloud-test-${randomUUID()}`;
const password = randomUUID();
let running = false;
let child;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();
function cleanup() {
  if (running) {
    docker('rm', '-f', '-v', name);
    running = false;
  }
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    child?.kill(signal);
    cleanup();
    process.exit(code);
  });
}
try {
  docker('run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=cloud_test', 'postgres:18-alpine');
  running = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      docker('exec', name, 'pg_isready', '-U', 'postgres', '-d', 'cloud_test');
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  if (!ready) throw new Error('Test PostgreSQL did not become ready within 30 seconds');
  const port = docker('port', name, '5432/tcp').split(':').at(-1);
  child = spawn('pnpm', ['test:packages'], {
    stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/cloud_test` },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  cleanup();
}
