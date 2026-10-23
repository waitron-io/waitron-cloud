import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ContinuityAuthority, RegistryPolicy } from '../src/policy.ts';
import type { ReceiptTrust } from '../src/evidence.ts';

export const policy: RegistryPolicy = {
  continuityTimeoutMs: 1000,
  witnessMaxAgeMs: 5000,
  writerLifetimeMs: 60000,
};
export async function retain(name: string, value: unknown) {
  if (process.env.FISCAL_CONTINUITY_RECEIPT_DIR)
    await writeFile(
      join(process.env.FISCAL_CONTINUITY_RECEIPT_DIR, name + '.json'),
      JSON.stringify(value, null, 2) + '\n',
    );
}
export async function authorityFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-fiscal-continuity-'));
  let process: ChildProcess;
  let url = '';
  let trust: ReceiptTrust;
  let publicKey = '',
    keyId = '';
  async function start() {
    process = spawn(
      'node',
      [new URL('./continuity-authority.ts', import.meta.url).pathname, directory],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const lines = createInterface({ input: process.stdout! });
    const ready = await Promise.race([
      once(lines, 'line'),
      once(process, 'exit').then(() => {
        throw Error('authority exited before ready');
      }),
    ]);
    const info = JSON.parse(String(ready[0]));
    lines.close();
    url = info.url;
    publicKey = info.publicKey;
    keyId = info.keyId;
    trust = { issuer: 'fixture-registry', keys: new Map([[keyId, publicKey]]) };
  }
  async function stop() {
    const exited = once(process, 'exit');
    process.kill('SIGTERM');
    await exited;
  }
  await start();
  async function request(action: string, body: unknown) {
    const response = await fetch(url + '/' + action, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error(data.code), { code: data.code });
    return data;
  }
  function adapter(overrides: Partial<ContinuityAuthority> = {}): ContinuityAuthority {
    return {
      verification: {
        authorityId: 'fixture-authority',
        keys: new Map([[keyId, publicKey]]),
        receipts: trust,
        policy,
      },
      current: (scope, nonce) => request('current', { scope, nonce }),
      history: (scope, afterSequence, nonce) => request('history', { scope, afterSequence, nonce }),
      fence: (scope, nonce) => request('fence', { scope, nonce }),
      claim: (input) => request('claim', input),
      ...overrides,
    };
  }
  async function worker(action: string, input: unknown) {
    const child = spawn('node', [new URL('./continuity-worker.ts', import.meta.url).pathname], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout!.on('data', (b) => {
      output += b;
    });
    child.stdin!.end(JSON.stringify({ url, publicKey, keyId, policy, action, input }));
    const [code] = await once(child, 'exit');
    if (code !== 0) throw Error('worker failed: ' + output);
    return JSON.parse(output);
  }
  return {
    adapter,
    request,
    worker,
    async restart() {
      await stop();
      await start();
    },
    async close() {
      await stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function continuityTrace(
  name: 'old-backup' | 'replacement-writer' | 'expired-witness',
  emit: (line: string) => void = line => { process.stderr.write(line + '\n'); },
) {
  const started = performance.now();
  let verifiedAt: number | undefined;
  let verifiedAge: number | undefined;
  return (stage: string, details: {
    observedAt?: string;
    waiting?: boolean;
    result?: { code?: unknown; receipt?: unknown };
  } = {}) => {
    // Diagnostics must never replace the assertion or expose a receipt or provider error.
    try {
      const now = performance.now();
      if (stage === 'witness-verified') {
        verifiedAt = now;
        const age = Date.now() - Date.parse(details.observedAt ?? '');
        verifiedAge = Number.isFinite(age) ? age : undefined;
      }
      const sinceVerifiedMs = verifiedAt === undefined ? undefined : now - verifiedAt;
      const code = details.result?.code;
      emit(JSON.stringify({
        continuity: name, stage, elapsedMs: now - started,
        sinceVerifiedMs,
        witnessAgeMs: verifiedAge === undefined ? undefined : verifiedAge + (sinceVerifiedMs ?? 0),
        waiting: details.waiting,
        ...(details.result ? {
          code: code === undefined ? 'none' :
            ['history_uncertain', 'continuity_unavailable', 'allocation_unavailable',
              'binding_conflict', 'invalid_input', 'unexpected_error'].includes(String(code)) ? code : 'unknown',
          receipt: !!details.result.receipt,
        } : {}),
      }));
    } catch {}
  };
}
