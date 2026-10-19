import type {TranslationMachine} from '@waitron-cloud/translation';
import type {PlanMode} from '@waitron-cloud/registration';
import type {RegistryOptions} from '@waitron-cloud/fiscal-allocation';
import type {RemoteResolver} from './remote-access.ts';
import type {CaptureOptions} from '@waitron-cloud/backups/captures';
import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { getPath } from 'hono/utils/url';
import type { Pool } from 'pg';
import type { RelayAdmissionConfig, EmailOutbox, LeaseIssuer, PasswordScreeningProvider } from '@waitron-cloud/registration';
import { validateConfig, type AccountHttpConfig, type FactorConfig } from './config.ts';
import { portalErrorResponse, portalResponse, securityHeaders, type PortalAssets } from './portal.ts';
import { createAccountApp } from './app.ts';
import { clientAddress } from './client-address.ts';
import { submitPath, submitRequestMs, submitSlots } from './translation.ts';
function unavailable(request?: Request, portal = false) {
  if (request && portal && !new URL(request.url).pathname.startsWith('/api/')) return portalErrorResponse(request, 503);
  return Response.json({error: 'temporarily_unavailable'}, {status: 503, headers: {
    ...securityHeaders, 'Retry-After': '1',
  }});
}
export async function startAccountServer(options: {pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig;factor?:FactorConfig;fiscalAllocation?:RegistryOptions; host?: string; port?: number; portalAssets?: PortalAssets;relay?:RelayAdmissionConfig;staffCertificates?:boolean;translation?:boolean;translationMachine?:TranslationMachine;leaseIssuer?:LeaseIssuer;leaseTrust?:ReadonlyMap<string,string>;captures?:CaptureOptions;planMode?:PlanMode;remoteResolve?:RemoteResolver;passwordScreening?:PasswordScreeningProvider}): Promise<{server: Server; close(): Promise<void>}> {
  const config = validateConfig(options.config);
  const app = createAccountApp({...options, config});
  let active = 0;let readinessActive=0; let stopping = false; let closing: Promise<void> | undefined;
  let submitting = 0; const submitters = new Set<string>();
  const listener = getRequestListener(async (request, bindings) => {
    const url = new URL(request.url);
    const portalRequest = !!options.portalAssets && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/installations/email/');
    if (portalRequest) {
      const host = new URL(options.config.portalOrigin).host;
      if (url.host !== host || (request.headers.has('host') && request.headers.get('host') !== host))
        return new Response(null, {status: 403, headers: securityHeaders});
    }
    if (stopping) return unavailable(request, portalRequest);
    if (portalRequest) return portalResponse(request, options.portalAssets!);
    if (url.pathname === '/api/health/live') return app.fetch(request, bindings);
    // Encoded aliases must use the same admission as the router's decoded submit path.
    if (options.translation && getPath(request) === submitPath) {
      let ip: string | undefined;
      try {ip = clientAddress(bindings.incoming.socket.remoteAddress ?? '', request.headers.get('x-forwarded-for') ?? undefined, config.trustedProxyIps);}
      catch {ip = undefined;}
      if (ip !== undefined) {
        if (submitting >= submitSlots || submitters.has(ip)) return unavailable();
        submitting++; submitters.add(ip);
        try {return await app.fetch(request, bindings);}
        finally {submitting--; submitters.delete(ip);}
      }
    }
    const readiness=url.pathname==='/api/health/ready';
    if (active >= 8||(readiness&&readinessActive>=1)) return unavailable();
    active++;if(readiness)readinessActive++;
    try {return await app.fetch(request, bindings);}
    finally {active--;if(readiness)readinessActive--;}
  }, {overrideGlobalObjects: false, errorHandler: () => unavailable()});
  const server = createServer({maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: options.translation ? submitRequestMs : 5000, connectionsCheckingInterval: 1000}, listener);
  server.maxConnections = 200;
  server.on('clientError', (error: NodeJS.ErrnoException, socket) => {
    if (!socket.writable || socket.writableEnded) return;
    const status = error.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large'
      : error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout' : '400 Bad Request';
    const body = '{"error":"invalid_input"}';
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n\r\n${body}`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3000, options.host ?? '127.0.0.1', () => {server.removeListener('error', reject); resolve();});
  });
  return {server, close() {
    if (!closing) {
      stopping = true;
      closing = new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => server.closeAllConnections(), 10000); deadline.unref();
        server.close(error => {clearTimeout(deadline); if (error) reject(error); else resolve();});
      });
    }
    return closing;
  }};
}
