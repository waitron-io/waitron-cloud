import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Each run owns its container and random loopback port; no developer database is reset.
const name = `waitron-cloud-test-${randomUUID()}`;
const password = randomUUID();
let running = false;
let mailRunning = false;
let child;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();
async function ensureTestImage(image) {
  const deadline = performance.now() + 120_000;
  const remaining = () => Math.ceil(deadline - performance.now());
  const command = (...args) => execFileSync('docker', args, {
    encoding: 'utf8', timeout: Math.max(1, remaining()), killSignal: 'SIGKILL',
  });
  try {
    command('image', 'inspect', image);
    return;
  } catch (error) {
    if (!/No such (?:image|object):/i.test(String(error.stderr))) throw error;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      command('pull', image);
      return;
    } catch (error) {
      const pause = attempt * 1000;
      const transient = error.code === 'ETIMEDOUT'
        || /Client\.Timeout|i\/o timeout|TLS handshake timeout|context deadline exceeded|connection reset by peer|unexpected EOF/i.test(String(error.stderr));
      if (!transient || attempt >= 3 || remaining() <= pause) throw error;
      console.error(`Test image pull timed out or lost its connection; retrying ${image} (${attempt + 1}/3)`);
      await delay(pause);
      if (remaining() <= 0) throw error;
    }
  }
}
function cleanup() {
  if (mailRunning) {
    docker('rm', '-f', '-v', `${name}-mail`);
    mailRunning = false;
  }
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
  // Acquire both images before resource ownership starts; container creation is never retried.
  await ensureTestImage('postgres:18-alpine');
  await ensureTestImage('axllent/mailpit:v1.31.1');
  docker('run', '--pull=never', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::5432',
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
  docker('run', '--pull=never', '--detach', '--rm', '--name', `${name}-mail`, '--publish', '127.0.0.1::1025',
    '--publish', '127.0.0.1::8025', '--env', 'MP_MAX_MESSAGE_SIZE=1', 'axllent/mailpit:v1.31.1');
  mailRunning = true;
  const smtpPort = docker('port', `${name}-mail`, '1025/tcp').split(':').at(-1);
  const inboxPort = docker('port', `${name}-mail`, '8025/tcp').split(':').at(-1);
  const inboxUrl = `http://127.0.0.1:${inboxPort}`;
  let mailReady = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${inboxUrl}/api/v1/messages`, { signal: AbortSignal.timeout(1000) })).ok) { mailReady = true; break; }
    } catch { /* The container is still starting. */ }
    await delay(500);
  }
  if (!mailReady) throw new Error('Test Mailpit did not become ready within 30 seconds');
  child = spawn('pnpm', process.argv.length > 2 ? process.argv.slice(2) : ['test:packages'], {
    stdio: 'inherit',
    env: { ...process.env, CLOUD_RECOVERY_ACTIVE_KEY_ID: 'test', CLOUD_RECOVERY_KEYS: JSON.stringify({test:randomBytes(32).toString('hex')}), CLOUD_PAIRING_ACTIVE_KEY_ID: 'test', CLOUD_PAIRING_KEYS: JSON.stringify({test:randomBytes(32).toString('hex')}), TEST_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/cloud_test`,
      MAILPIT_TEST_URL: inboxUrl, MAILPIT_TEST_SMTP_PORT: smtpPort },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  cleanup();
}
