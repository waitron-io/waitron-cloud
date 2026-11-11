import type {BillingMethodsOptions} from './billing-methods.ts';
import type {BillingAccountOptions} from './config.ts';
import type {TunnelProvisionOptions} from './tunnel-provision.ts';
import type {AddressLookupOptions} from './address-lookup.ts';
import type {TranslationMachine} from '@waitron-cloud/translation';
import type {AllowanceOptions,PlanMode} from '@waitron-cloud/registration';
import type {RemoteResolver} from './remote-access.ts';
import type {CaptureOptions} from '@waitron-cloud/backups/captures';
import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { getPath } from 'hono/utils/url';
import type { Pool } from 'pg';
import type { RelayAdmissionConfig, EmailOutbox, LeaseIssuer, PasswordScreeningProvider } from '@waitron-cloud/registration';
import { validateConfig, type AccountHttpConfig, type FactorConfig } from './config.ts';
import { portalErrorResponse, portalResponse, portalSecurityHeaders, securityHeaders, type PortalAssets } from './portal.ts';
import { createAccountApp } from './app.ts';
import { clientAddress } from './client-address.ts';
import { submitPath, submitRequestMs, submitSlots } from './translation.ts';
import {RequestMetrics,requestGroup} from './request-metrics.ts';
import type {Duplex} from 'node:stream';
function unavailable(request?: Request, portal = false, testBillingMethods=false) {
  if (request && portal && !new URL(request.url).pathname.startsWith('/api/')) return portalErrorResponse(request, 503,testBillingMethods);
  return Response.json({error: 'temporarily_unavailable'}, {status: 503, headers: {
    ...securityHeaders, 'Retry-After': '1',
  }});
}
export async function startAccountServer(options: {pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig;factor?:FactorConfig; host?: string; port?: number;localMetrics?:{host:string;port:number}; portalAssets?: PortalAssets;relay?:RelayAdmissionConfig;staffCertificates?:boolean;addressLookup?:AddressLookupOptions;tunnelProvision?:TunnelProvisionOptions;translation?:boolean;translationMachine?:TranslationMachine;leaseIssuer?:LeaseIssuer;leaseTrust?:ReadonlyMap<string,string>;captures?:CaptureOptions;planMode?:PlanMode;allowances?:AllowanceOptions;billingAccount?:BillingAccountOptions;billingMethods?:BillingMethodsOptions;remoteResolve?:RemoteResolver;passwordScreening?:PasswordScreeningProvider}): Promise<{server: Server;metricsServer?:Server; close(): Promise<void>}> {
  const config = validateConfig(options.config);
  if(options.localMetrics&&config.production)throw Error('Local metrics are unavailable in production');
  const app = createAccountApp({...options, config});
  let active = 0;let readinessActive=0; let stopping = false; let closing: Promise<void> | undefined;
  let submitting = 0; const submitters = new Set<string>();
  const listener = getRequestListener(async (request, bindings) => {
    const url = new URL(request.url);
    const portalRequest = !!options.portalAssets && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/installations/email/');
    if (portalRequest) {
      const host = new URL(options.config.portalOrigin).host;
      if (url.host !== host || (request.headers.has('host') && request.headers.get('host') !== host))
        return new Response(null, {status: 403, headers: portalSecurityHeaders(!!options.billingMethods)});
    }
    if (stopping) return unavailable(request, portalRequest,!!options.billingMethods);
    if (portalRequest) return portalResponse(request, options.portalAssets!,!!options.billingMethods);
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
  const metrics=new RequestMetrics();
  const receiving=new WeakMap<Duplex,(status:number)=>void>();
  const server = createServer({maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: options.translation ? submitRequestMs : 5000, connectionsCheckingInterval: 1000}, (request,response)=>{
    const started=performance.now(),group=requestGroup(request.url??'',!!options.portalAssets);
    const forget=()=>{if(receiving.get(request.socket)===settle)receiving.delete(request.socket);};
    const settle=(status:number)=>{forget();metrics.record(group,status,(performance.now()-started)/1000);};
    receiving.set(request.socket,settle);
    response.once('finish',()=>settle(response.statusCode));
    response.once('close',forget);
    void listener(request,response);
  });
  server.maxConnections = 200;
  server.on('clientError', (error: NodeJS.ErrnoException, socket) => {
    if (!socket.writable || socket.writableEnded) return;
    const status = error.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large'
      : error.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout' : '400 Bad Request';
    // A peer ending an unfinished body supplies no completed response or timeout measurement.
    if(!['ECONNRESET','HPE_INVALID_EOF_STATE'].includes(error.code??'')){
      const settle=receiving.get(socket);
      if(settle)settle(Number(status.slice(0,3)));else metrics.record('parser',Number(status.slice(0,3)));
    }
    const body = '{"error":"invalid_input"}';
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n\r\n${body}`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3000, options.host ?? '127.0.0.1', () => {server.removeListener('error', reject); resolve();});
  });
  let metricsServer:Server|undefined;
  if(options.localMetrics){
    metricsServer=createServer((request,response)=>{
      response.setHeader('cache-control','no-store');
      if(request.method!=='GET'||request.url!=='/metrics'){response.writeHead(404);response.end();return;}
      response.setHeader('content-type','application/json');response.end(JSON.stringify(metrics.snapshot()));
    });
    try{await new Promise<void>((resolve,reject)=>{metricsServer!.once('error',reject);metricsServer!.listen(options.localMetrics!.port,options.localMetrics!.host,()=>{metricsServer!.removeListener('error',reject);resolve();});});}
    catch(error){await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});throw error;}
  }
  return {server,metricsServer, close() {
    if (!closing) {
      stopping = true;
      closing = Promise.all([server,...(metricsServer?[metricsServer]:[])].map(current=>new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => current.closeAllConnections(), 10000); deadline.unref();
        current.close(error => {clearTimeout(deadline); if (error) reject(error); else resolve();});
      }))).then(()=>{});
    }
    return closing;
  }};
}
