import type {CaptureOptions} from '../../../packages/backups/src/captures.ts';
import {generateKeyPairSync} from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type {IncomingMessage,ServerResponse} from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { database } from '../../../packages/account-http/test/fixtures.ts';
import { startAccountServer } from '@waitron-cloud/account-http';
import { loadPortalAssets } from '../../../packages/account-http/src/portal.ts';
import { EmailWorker, createLocalAccountMailer, createLeaseIssuer } from '@waitron-cloud/registration';

export async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  await session.send('WebAuthn.enable');
  const {authenticatorId} = await session.send('WebAuthn.addVirtualAuthenticator', {options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  }});
  return {authenticatorId, async close() {
    await session.send('WebAuthn.removeVirtualAuthenticator', {authenticatorId}).catch(() => undefined);
    await session.send('WebAuthn.disable').catch(() => undefined);
    await session.detach().catch(() => undefined);
  }};
}
export async function startPortalFixture(captures?:CaptureOptions,remoteResolve?:(name:string)=>Promise<string[]>) {
  const db = await database();
  const reserved = createServer();
  await new Promise<void>(resolve => reserved.listen(0, '127.0.0.1', resolve));
  const address = reserved.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => reserved.close(() => resolve()));
  // WebAuthn requires an RP ID that is a domain; localhost remains a secure-context exception.
  const origin = `http://localhost:${address.port}`;
  let running: Awaited<ReturnType<typeof startAccountServer>> | undefined;
  let browser: Browser | undefined;
  try {
    const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
    running = await startAccountServer({captures,remoteResolve,leaseIssuer:issuer,pool: db.pool, outbox: db.outbox, port: address.port,
      config: {portalOrigin: origin, production: false, rateKey: db.rateKey, trustedProxyIps: []},
      portalAssets: await loadPortalAssets(new URL('../dist', import.meta.url).pathname)});
    browser = await chromium.launch({headless: true});
    const worker = new EmailWorker(db.pool, db.outbox, createLocalAccountMailer({
      port: Number(process.env.MAILPIT_TEST_SMTP_PORT), portalOrigin: origin,
    }));
    return {origin, browser, db, issuer,
      traceRemoteRequests(record:(event:unknown)=>void) {
        const server=running!.server;let nextSocket=0;const sockets=new WeakMap<object,number>();
        const hook=(request:IncomingMessage,response:ServerResponse)=>{
          const path=request.url?.split('?')[0];if(!path?.startsWith('/api/account/remote-access/'))return;
          let socket=sockets.get(request.socket);if(!socket){socket=++nextSocket;sockets.set(request.socket,socket);}
          record({serverRequest:path,socket});
          request.once('end',()=>record({serverBodyEnd:path,socket}));
          response.once('finish',()=>record({serverFinish:path,status:response.statusCode,socket}));
          response.once('close',()=>record({serverClose:path,finished:response.writableFinished,socket}));
        };
        server.prependListener('request',hook);
        return ()=>server.removeListener('request',hook);
      },
      loseRecoveryReply(action: 'approve' | 'replace') {
        // Drop the socket after the handler commits, so reconciliation uses ordinary browser networking.
        return new Promise<{status: number; body: string}>(resolve => {
          const server=running!.server;
          const hook = (request:IncomingMessage,response:ServerResponse) => {
            if(request.url!==`/api/account/recovery/${action}`)return;
            server.removeListener('request',hook);
            response.end=(body?: unknown)=>{
              resolve({status:response.statusCode,body:String(body??'')});
              request.socket.destroy();return response;
            };
          };
          server.prependListener('request',hook);
        });
      },
      loseMachineReply(action: string) {
        const server=running!.server;
        const hook: Parameters<typeof server.prependListener>[1] = (request, response) => {
          if(request.url!==`/api/installations/${action}`)return;
          server.removeListener('request',hook);
          response.end=()=>{request.socket.destroy();return response;};
        };
        server.prependListener('request',hook);
      },
      loseAccountReply(path: string) {
        const server=running!.server;
        const hook: Parameters<typeof server.prependListener>[1] = (request, response) => {
          if(request.url!==`/api/account${path}`)return;
          server.removeListener('request',hook);
          response.end=()=>{request.socket.destroy();return response;};
        };
        server.prependListener('request',hook);
      },
      async drainMail() { while (await worker.runOnce()) {} },
      async close() { await browser?.close(); await running?.close(); await db.close(); },
    };
  } catch (error) { await browser?.close(); await running?.close(); await db.close(); throw error; }
}
export async function mailFor(email: string, subject: string): Promise<string> {
  const inbox = process.env.MAILPIT_TEST_URL!;
  const response = await fetch(`${inbox}/api/v1/messages`);
  const list = await response.json() as {messages: {ID: string; Subject: string; To: {Address: string}[]}[]};
  const found = list.messages.find(message => message.Subject === subject && message.To.some(to => to.Address === email));
  assert.ok(found, `Missing ${subject} message`);
  const message = await (await fetch(`${inbox}/api/v1/message/${found.ID}`)).json() as {Text: string};
  return message.Text;
}
