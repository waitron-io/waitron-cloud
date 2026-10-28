import {spawn} from 'node:child_process';
import {appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// The bootstrap lock comes from pnpm/action-setup at
// 0977fd99725f1db4007ccb2928dbb4e90d06cc86/src/install-pnpm/bootstrap/pnpm-lock.json.
// Its self-update performs signature verification before the target can execute.
const repository = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('./ci-pnpm-bootstrap-lock.json', import.meta.url), 'utf8'));
const manager = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).packageManager;
const match = /^pnpm@(\d+\.\d+\.\d+)(?:\+[^\s]+)?$/.exec(manager ?? '');
let current;
let cancelled = false;
let cancellationTimer;
let killGrace = 2_000;
function killGroup(signal) {
  if (!current?.pid) return;
  try {process.kill(-current.pid, signal);} catch (error) {if (error.code !== 'ESRCH') throw error;}
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  cancelled = true;
  killGroup('SIGTERM');
  cancellationTimer ??= setTimeout(() => killGroup('SIGKILL'), killGrace);
});

function budget(name, fallback) {
  const value = process.env[name] ?? String(fallback);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2_147_483_647) {
    throw Error(`${name} must be a positive whole number of milliseconds`);
  }
  return Number(value);
}

async function command(executable, args, cwd, env, deadline, grace) {
  if (cancelled) return {code: 1, permanent: true};
  let stdout = '', tail = '', permanent = false, transient = false, timedOut = false;
  const observe = (chunk, destination) => {
    destination.write(chunk);
    tail = (tail + chunk.toString()).slice(-65_536);
    // An explicit verification refusal wins even when it also mentions a reset.
    permanent ||= /EINTEGRITY|ERR_PNPM_(?:PNPM_ENGINE_IDENTITY|INVALID_SIGNATURE)|invalid signature|signature (?:verification )?failed/i.test(tail);
    transient ||= /(?:\b|ERR_PNPM_)(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|FETCH_ERROR)\b|ERR_PNPM_FETCH_(?:429|502|503|504)\b/.test(tail);
  };
  return await new Promise(resolve => {
    const child = spawn(executable, args, {cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    current = child;
    child.stdout.on('data', chunk => {stdout += chunk.toString(); if (stdout.length > 65_536) stdout = stdout.slice(-65_536); observe(chunk, process.stdout);});
    child.stderr.on('data', chunk => observe(chunk, process.stderr));
    let killTimer;
    const stop = () => {
      timedOut = true;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), grace);
    };
    const timer = setTimeout(stop, Math.max(1, deadline - Date.now()));
    child.once('error', () => {permanent = true;});
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      clearTimeout(cancellationTimer);
      // The child owns this process group; no descendant may outlive an attempt.
      killGroup('SIGKILL');
      current = undefined;
      resolve({code, signal, stdout, permanent, transient, timedOut});
    });
  });
}

async function setup() {
  if (!match) throw Error('package.json must pin an exact pnpm version');
  for (const name of ['RUNNER_TEMP', 'GITHUB_PATH', 'GITHUB_ENV']) {
    if (!process.env[name]) throw Error(`${name} must be set`);
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw Error('pnpm bootstrap needs Node 22.13 or newer');
  const bound = budget('PNPM_SETUP_ATTEMPT_MS', 30_000);
  const grace = budget('PNPM_SETUP_KILL_MS', 2_000);
  killGrace = grace;
  const root = mkdtempSync(join(process.env.RUNNER_TEMP, 'cloud-pnpm-setup-'));
  const version = match[1];
  let published = false;
  try {
    for (let attempt = 1; attempt <= 3 && !cancelled; attempt++) {
      console.error(`pnpm setup attempt ${attempt} of 3`);
      const cwd = join(root, `attempt-${attempt}`);
      const home = join(cwd, 'home');
      mkdirSync(cwd);
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({private: true, dependencies: lock.packages[''].dependencies}));
      writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify(lock));
      const observer = fileURLToPath(new URL('./ci-pnpm-diagnostics.cjs', import.meta.url));
      const env = {...process.env, PNPM_HOME: home,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${observer}`,
        npm_config_fetch_timeout: '15000', npm_config_fetch_retries: '1', npm_config_fetch_retry_mintimeout: '1000'};
      const deadline = Date.now() + bound;
      let result = await command('npm', ['ci', '--no-audit', '--no-fund'], cwd, env, deadline, grace);
      if (result.code === 0 && !result.timedOut && !cancelled) {
        result = await command(process.execPath, [join(cwd, 'node_modules/pnpm/bin/pnpm.mjs'), 'self-update', version], cwd, env, deadline, grace);
      }
      if (result.code === 0 && !result.timedOut && !cancelled) {
        const bin = join(home, 'bin');
        const checked = await command(join(bin, 'pnpm'), ['--version'], cwd, env, deadline, grace);
        if (checked.code !== 0 || checked.timedOut || checked.stdout.trim() !== version || cancelled) {
          throw Error('installed pnpm did not confirm the pinned version');
        }
        appendFileSync(process.env.GITHUB_ENV, `PNPM_HOME=${home}\n`);
        appendFileSync(process.env.GITHUB_PATH, `${bin}\n`);
        published = true;
        console.log(`pnpm ${version} installed on attempt ${attempt} of 3`);
        return;
      }
      rmSync(cwd, {recursive: true, force: true});
      if (cancelled || result.permanent || (!result.timedOut && !result.transient)) {
        throw Error('pnpm setup refused; verification and unclassified failures are not retried');
      }
      console.error(`pnpm setup attempt ${attempt} failed at a transient transport boundary or its time limit`);
    }
    throw Error('pnpm setup failed within its bounded attempts');
  } finally {if (!published) rmSync(root, {recursive: true, force: true});}
}

try {await setup();}
catch (error) {console.error(error.message); process.exitCode = 1;}
