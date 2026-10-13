import type { Context } from 'hono';
import type { Pool } from 'pg';
import {
  FiscalAllocationStore,
  FiscalAllocationError,
  canonical,
  type RegistryOptions,
} from '@waitron-cloud/fiscal-allocation';
import {
  validateReserve,
  validateConsume,
  validateAbandon,
  validateStatus,
  validateList,
  validatePaperHistory,
} from '@waitron-cloud/fiscal-allocation';
import { AccountHttpError } from './errors.ts';
import { readBoundedJsonObject } from './request.ts';
import { readSessionCookie } from './cookies.ts';
import type { RateRule } from './rate-limit.ts';
import { authenticateFiscalReport, reportFiscalAllocation } from '@waitron-cloud/fiscal-allocation';

export interface FiscalHttpOptions {
  pool: Pool;
  registry: RegistryOptions | null;
  origin: string;
  ip: string;
  consume: (rules: RateRule[]) => Promise<void>;
}
export async function fiscalAllocationResponse(
  c: Context,
  options: FiscalHttpOptions,
): Promise<Response> {
  if (c.req.method !== 'POST') throw new AccountHttpError(405, 'method_not_allowed');
  if (c.req.path === '/api/installations/fiscal-allocations/report') {
    if (c.req.header('origin') !== undefined) throw new AccountHttpError(403, 'forbidden');
    await options.consume([
      {
        scope: 'fiscal-machine-ip',
        subject: options.ip,
        limit: 60,
        windowSeconds: 60,
      },
    ]);
    const proof = await readBoundedJsonObject(c.req.raw);
    if (!options.registry || options.registry.machine?.origin !== options.origin)
      throw new FiscalAllocationError('continuity_unavailable');
    const claims = await authenticateFiscalReport(options.pool, options.registry, proof);
    await options.consume([
      {
        scope: 'fiscal-machine-installation',
        subject: claims.installationId,
        limit: 30,
        windowSeconds: 60,
      },
    ]);
    return c.json(await reportFiscalAllocation(options.pool, options.registry, proof));
  }
  if (c.req.header('origin') !== options.origin) throw new AccountHttpError(403, 'forbidden');
  const suffix = c.req.path.slice('/api/account/fiscal-allocations/'.length);
  if (!['reserve', 'consume', 'abandon', 'status', 'list', 'import-paper'].includes(suffix))
    throw new AccountHttpError(404, 'not_found');
  await options.consume([
    { scope: 'fiscal-ip', subject: options.ip, limit: 60, windowSeconds: 60 },
  ]);
  const body = await readBoundedJsonObject(c.req.raw);
  if (!options.registry) throw new FiscalAllocationError('continuity_unavailable');
  const store = new FiscalAllocationStore(options.pool, options.registry);
  const token = readSessionCookie(c, new URL(options.origin).protocol === 'https:') ?? '',
    csrf = c.req.header('x-csrf-token') ?? '';
  const input =
    suffix === 'reserve'
      ? validateReserve(body)
      : suffix === 'consume'
        ? validateConsume(body)
        : suffix === 'abandon'
          ? validateAbandon(body)
          : suffix === 'status'
            ? validateStatus(body)
            : suffix === 'list'
              ? validateList(body)
              : validatePaperHistory(body);
  const authorized = await store.authorizeRequest(
    token,
    csrf,
    suffix as Parameters<typeof store.authorizeRequest>[2],
    input,
  );
  const rules: RateRule[] = [
    {
      scope: 'fiscal-account',
      subject: authorized.accountId,
      limit: 30,
      windowSeconds: 60,
    },
  ];
  if (authorized.scope)
    rules.push({
      scope: 'fiscal-namespace',
      subject: canonical(authorized.scope),
      limit: 10,
      windowSeconds: 60,
    });
  await options.consume(rules);
  const result =
    suffix === 'reserve'
      ? await store.reserve(token, csrf, input as ReturnType<typeof validateReserve>)
      : suffix === 'consume'
        ? await store.consume(token, csrf, input as ReturnType<typeof validateConsume>)
        : suffix === 'abandon'
          ? await store.abandon(token, csrf, input as ReturnType<typeof validateAbandon>)
          : suffix === 'status'
            ? await store.status(token, csrf, input as ReturnType<typeof validateStatus>)
            : suffix === 'list'
              ? await store.list(token, csrf, input as ReturnType<typeof validateList>)
              : await store.importPaper(
                  token,
                  csrf,
                  input as ReturnType<typeof validatePaperHistory>,
                );
  if (Buffer.byteLength(JSON.stringify(result)) > 262144)
    throw new FiscalAllocationError('allocation_unavailable');
  return c.json(result);
}
