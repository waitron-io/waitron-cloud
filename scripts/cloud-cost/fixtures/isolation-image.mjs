import {execFile} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';

const execute = promisify(execFile);

export async function isolationTestImage({budgetMs = 120000} = {}) {
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 120000) throw Error('Invalid isolation image budget');
  const deadline = performance.now() + budgetMs;
  const remaining = () => Math.ceil(deadline - performance.now());
  const docker = async (...args) => {
    const timeout = remaining();
    if (timeout <= 0) throw Error('Isolation image acquisition timed out');
    const result = await execute('docker', args, {encoding: 'utf8', env: {PATH: process.env.PATH}, timeout, killSignal: 'SIGKILL'});
    return result.stdout.trim();
  };
  const inspect = () => docker('image', 'inspect', 'node:26-slim', '--format', '{{.Id}}');
  try {return await inspect();} catch (error) {
    if (!/No such (?:image|object):/i.test(String(error.stderr))) throw error;
  }
  // Preparation precedes resource ownership; retries never repeat container creation.
  for (let attempt = 1; ; attempt++) {
    try {await docker('pull', 'node:26-slim'); break;} catch (error) {
      const message = String(error.stderr), pause = attempt * 1000;
      const terminal = /denied|unauthorized|authentication required|manifest unknown|not found|toomanyrequests|rate limit|invalid reference format/i.test(message);
      const transient = /received unexpected HTTP status: 5\d\d\b|Client\.Timeout|i\/o timeout|TLS handshake timeout|context deadline exceeded|connection reset by peer|unexpected EOF/i.test(message);
      if (terminal || !transient || attempt >= 3 || remaining() <= pause) throw error;
      console.error(`Isolation image pull failed temporarily; retrying node:26-slim (${attempt + 1}/3)`);
      await delay(pause);
    }
  }
  return inspect();
}
