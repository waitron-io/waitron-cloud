import { createServer, type Server } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import type { Pool } from 'pg';
import type { EmailOutbox } from '@waitron-cloud/registration';
import type { AccountHttpConfig } from './config.ts';
import { createAccountApp } from './app.ts';
function unavailable() {
  return Response.json({error: 'temporarily_unavailable'}, {status: 503, headers: {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Retry-After': '1',
  }});
}
export async function startAccountServer(options: {pool: Pool; outbox: EmailOutbox; config: AccountHttpConfig; host?: string; port?: number}): Promise<{server: Server; close(): Promise<void>}> {
  const app = createAccountApp(options);
  let active = 0; let stopping = false; let closing: Promise<void> | undefined;
  const listener = getRequestListener(async (request, bindings) => {
    if (stopping || active >= 8) return unavailable();
    active++;
    try {return await app.fetch(request, bindings);}
    finally {active--;}
  }, {overrideGlobalObjects: false, errorHandler: () => unavailable()});
  const server = createServer({maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 5000, connectionsCheckingInterval: 1000}, listener);
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
