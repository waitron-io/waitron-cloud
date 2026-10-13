import assert from 'node:assert/strict';
import { randomBytes, randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { EmailOutbox } from '@waitron-cloud/registration';
import { startAccountServer } from '../src/server.ts';
import { storeFixture } from '../../fiscal-allocation/test/store-fixture.ts';
import { canonical } from '../../fiscal-allocation/src/evidence.ts';
import { createLeaseTrust } from '../../registration/src/installation-proof.ts';
const origin = 'http://localhost';
const prefix = '/api/account/fiscal-allocations/';
export async function fiscalHttpFixture(enabled = true) {
  const s = await storeFixture();
  const v = await s.venue();
  const rateKey = randomBytes(32).toString('hex');
  const registryOptions = {
    ...s.options,
    machine: { origin, leaseTrust: createLeaseTrust(s.f.issuer) },
  };
  const servers: Awaited<ReturnType<typeof startAccountServer>>[] = [];
  async function server(
    registry: typeof s.options | undefined = enabled ? registryOptions : undefined,
  ) {
    const running = await startAccountServer({
      pool: s.f.pool,
      outbox: new EmailOutbox({
        activeKeyId: 'test',
        keys: { test: 'ab'.repeat(32) },
      }),
      config: {
        portalOrigin: origin,
        production: false,
        rateKey,
        trustedProxyIps: [],
      },
      port: 0,
      fiscalAllocation: registry,
    });
    servers.push(running);
    const address = running.server.address();
    assert.ok(address && typeof address !== 'string');
    return address.port;
  }
  const port = await server();
  async function request(
    suffix: string,
    body: unknown,
    options: {
      port?: number;
      method?: string;
      headers?: Record<string, string>;
      raw?: string;
      path?: string;
      noOrigin?: boolean;
    } = {},
  ) {
    return new Promise<Response>((resolve, reject) => {
      const headers: Record<string, string> = {
        host: 'localhost',
        origin,
        'content-type': 'application/json',
        cookie: `cloud_session=${v.session.token}`,
        'x-csrf-token': v.session.csrfToken,
        ...options.headers,
      };
      if (options.noOrigin && !Object.hasOwn(options.headers ?? {}, 'origin'))
        delete headers.origin;
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: options.port ?? port,
          path: options.path ?? prefix + suffix,
          method: options.method ?? 'POST',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const headers = new Headers();
            for (let i = 0; i < res.rawHeaders.length; i += 2)
              headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers,
              }),
            );
          });
          res.once('error', reject);
        },
      );
      req.once('error', reject);
      req.end(options.method === 'GET' ? undefined : (options.raw ?? JSON.stringify(body)));
    });
  }
  const machine = generateKeyPairSync('ed25519'),
    publicKey = machine.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  await s.f.pool.query('UPDATE installations SET public_key=$2 WHERE id=$1', [
    v.installation,
    publicKey,
  ]);
  const issuedAt = Date.now();
  const lease = s.f.issuer.issue({
    origin,
    leaseId: randomUUID(),
    installationId: v.installation,
    venueId: v.id,
    environment: 'test',
    publicKey,
    issuedAt,
    expiresAt: issuedAt + 3600000,
  });
  function proof(body: unknown, change: Record<string, unknown> = {}) {
    const c = {
      origin,
      action: 'report',
      installationId: v.installation,
      operationId: randomUUID(),
      issuedAt: Date.now(),
      lease: JSON.stringify(lease),
      bodyDigest: createHash('sha256').update(canonical(body)).digest('hex'),
      body,
      ...change,
    };
    const bytes = Buffer.from(
      canonical([
        'waitron.fiscal-machine-report',
        1,
        c.origin,
        c.action,
        c.installationId,
        c.operationId,
        c.issuedAt,
        c.lease,
        c.bodyDigest,
        c.body,
      ]),
    );
    return {
      payload: bytes.toString('base64url'),
      signature: sign(null, bytes, machine.privateKey).toString('base64url'),
    };
  }
  async function report(
    value: unknown,
    options: { headers?: Record<string, string>; port?: number } = {},
  ) {
    return request('', value, {
      ...options,
      path: '/api/installations/fiscal-allocations/report',
      headers: options.headers,
      noOrigin: true,
    });
  }
  return {
    ...s,
    options: registryOptions,
    v,
    port,
    server,
    request,
    proof,
    report,
    lease,
    async close() {
      for (const r of servers) await r.close();
      await s.close();
    },
  };
}
