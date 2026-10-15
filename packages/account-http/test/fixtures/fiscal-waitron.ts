import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { EmailOutbox } from '@waitron-cloud/registration';
import { startAccountServer } from '../../src/server.ts';
import { storeFixture } from '../../../fiscal-allocation/test/store-fixture.ts';
import { encodeReceipt } from '../../../fiscal-allocation/src/evidence.ts';
import { createLeaseTrust } from '../../../registration/src/installation-proof.ts';
import type { AllocationReceipt } from '../../../fiscal-allocation/src/types.ts';

export const waitronCandidate = '2293a60a311e20b227029782ba75048ee1fff241';
const bridge = fileURLToPath(new URL('./fiscal-waitron-bridge.mjs', import.meta.url));
async function freePort() {
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => listener.close((error) => error ? reject(error) : done()));
  return address.port;
}

export async function jointFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cloud-waitron-joint-'));
  let cloud: Awaited<ReturnType<typeof storeFixture>> | undefined;
  let server: Awaited<ReturnType<typeof startAccountServer>> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let exit: Promise<void> | undefined;
  const responses: { path: string; status: number }[] = [];
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  async function close() {
    if (child) {
      child.stdin?.end();
      const stopped = await Promise.race([exit!.then(() => true), delay(5000).then(() => false)]);
      if (!stopped) { child.kill('SIGTERM'); await exit; }
    }
    await server?.close();
    await cloud?.close();
    await rm(root, { recursive: true, force: true });
  }
  try {
    let candidate = process.env.WAITRON_FISCAL_TEST_CANDIDATE;
    if (!candidate) {
      candidate = join(root, 'waitron');
      execFileSync('git', ['init', '--quiet', candidate]);
      execFileSync('git', ['-C', candidate, 'fetch', '--quiet', '--depth=1', 'https://github.com/clintongormley/waitron.git', waitronCandidate], { timeout: 60000, stdio: 'pipe' });
      execFileSync('git', ['-C', candidate, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
      execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: candidate, timeout: 120000, stdio: 'pipe' });
    }
    candidate = resolve(candidate);
    assert.equal(execFileSync('git', ['-C', candidate, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), waitronCandidate);
    assert.equal(execFileSync('git', ['-C', candidate, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '', 'the pinned candidate must have no tracked edits');
    cloud = await storeFixture();
    const v = await cloud.venue();
    const port = await freePort();
    const origin = `http://localhost:${port}`;
    server = await startAccountServer({ pool: cloud.f.pool,
      outbox: new EmailOutbox({ activeKeyId: 'test', keys: { test: 'ab'.repeat(32) } }),
      config: { portalOrigin: origin, production: false, rateKey: randomBytes(32).toString('hex'), trustedProxyIps: [] },
      port, fiscalAllocation: { ...cloud.options, machine: { origin, leaseTrust: createLeaseTrust(cloud.f.issuer) } },
    });
    server.server.on('request', (request, response) => {
      response.once('finish', () => responses.push({ path: request.url ?? '', status: response.statusCode }));
    });
    const binding = { ...v.input.binding, eventId: 'joint-restore', targetNodeId: 'a0000000-0000-4000-8000-000000000008',
      operatorId: { kind: 'recovery-key', nodeId: 'a0000000-0000-4000-8000-000000000008', eventId: 'joint-restore' } };
    async function account(action: string, input: unknown) {
      const response = await fetch(`${origin}/api/account/fiscal-allocations/${action}`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: `cloud_session=${v.session.token}`, 'x-csrf-token': v.session.csrfToken }, body: JSON.stringify(input),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    const reserved: AllocationReceipt = await account('reserve', { ...v.input, binding });
    const operationId = randomUUID();
    const receipt: AllocationReceipt = await account('consume', { version: 1, operationId, allocationId: reserved.payload.allocation.allocationId, binding,
      oldMachineOffline: true, oldMachineAbsent: false, noParallelRecovery: true, confirmedAt: new Date().toISOString() });
    const machine = generateKeyPairSync('ed25519');
    const publicKey = machine.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    await cloud.f.pool.query('UPDATE installations SET public_key=$2 WHERE id=$1', [v.installation, publicKey]);
    const issuedAt = Date.now();
    const lease = cloud.f.issuer.issue({ origin, leaseId: randomUUID(), installationId: v.installation, venueId: v.id, environment: 'test', publicKey, issuedAt, expiresAt: issuedAt + 3600000 });
    const publicReceiptKey = cloud.options.trust!.keys.get(receipt.keyId)!;
    const keyId = createHash('sha256').update(Buffer.from(publicReceiptKey, 'base64url')).digest('hex');
    const configurationPath = join(root, 'configuration.json');
    await writeFile(configurationPath, JSON.stringify({ root, candidate, origin, receipt, packet: encodeReceipt(receipt), reserved,
      trust: { issuer: receipt.payload.issuer, keyId, publicKey: publicReceiptKey },
      account: { cookie: `cloud_session=${v.session.token}`, csrfToken: v.session.csrfToken },
      status: { version: 1, venueId: v.id, operationId },
      authentication: { origin, environment: 'dev', installationId: v.installation, privateKey: machine.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'), lease },
    }), { mode: 0o600 });
    child = spawn(process.execPath, ['--import', join(candidate, 'apps/server/node_modules/tsx/dist/loader.mjs'), bridge, configurationPath], { cwd: join(candidate, 'apps/server'), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.once('error', (error) => { for (const entry of pending.values()) entry.reject(error); pending.clear(); });
    child.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });
    exit = new Promise<void>((done) => child!.once('exit', () => { for (const entry of pending.values()) entry.reject(new Error(`Waitron bridge exited: ${stderr}`)); pending.clear(); done(); }));
    createInterface({ input: child.stdout! }).on('line', (line) => {
      if (!line.startsWith('JOINT:')) return;
      const message = JSON.parse(line.slice(6));
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.failure) entry.reject(new Error(message.failure)); else entry.resolve(message.result);
    });
    let nextId = 0;
    const call = (action: string, input: unknown) => new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const deadline = setTimeout(() => { pending.delete(id); reject(new Error(`Waitron bridge timed out on ${action}`)); }, 20000);
      pending.set(id, { resolve(value) { clearTimeout(deadline); resolve(value); }, reject(error) { clearTimeout(deadline); reject(error); } });
      child!.stdin!.write(JSON.stringify({ id, action, input }) + '\n');
    });
    await call('ready', {});
    return { cloud, receipt, reserved, responses, call, close };
  } catch (error) { await close(); throw error; }
}
