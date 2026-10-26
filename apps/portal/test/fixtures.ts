import {createMailCapture} from '../../../packages/account-http/test/mail-capture.ts';
import {TranslationFixture} from './translation-fixture.ts';
import type {RegistryOptions} from '../../../packages/fiscal-allocation/src/policy.ts';
import type {FactorConfig} from '../../../packages/account-http/src/config.ts';
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
export async function startPortalFixture(captures?:CaptureOptions,remoteResolve?:(name:string)=>Promise<string[]>,factor?:FactorConfig,fiscalAllocation?:RegistryOptions,translation?:{pageBytes?:number}) {
  const db = await database();
  const reserved = createServer();
  await new Promise<void>(resolve => reserved.listen(0, '127.0.0.1', resolve));
  const address = reserved.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => reserved.close(() => resolve()));
  // WebAuthn requires an RP ID that is a domain; localhost remains a secure-context exception.
  const origin = `http://localhost:${address.port}`;
  let running: Awaited<ReturnType<typeof startAccountServer>> | undefined;
  let browser: Browser | undefined;
  let translations:TranslationFixture|undefined;
  try {
    const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
    translations=translation?new TranslationFixture(db.pool,issuer,origin,translation.pageBytes):undefined;
    running = await startAccountServer({translation:!!translation,translationMachine:translations?.machine,captures,remoteResolve,factor,fiscalAllocation,leaseIssuer:issuer,pool: db.pool, outbox: db.outbox, port: address.port,
      config: {portalOrigin: origin, production: false, rateKey: db.rateKey, trustedProxyIps: []},
      portalAssets: await loadPortalAssets(new URL('../dist', import.meta.url).pathname)});
    translations?.attach(running.server);
    const trace:object[]=[];const traceStarted=performance.now();
    const tracedPaths=new Set(['/api/account/session','/api/account/session/activity','/api/account/login','/api/account/password-reset/complete','/api/account/translation-consent']);
    let requestId=0;
    running.server.on('request',(request,response)=>{
      const path=request.url?.split('?')[0];if(!path||!tracedPaths.has(path))return;
      const id=++requestId,started=performance.now();
      const record=(phase:string)=>{trace.push({id,path,method:request.method,phase,status:response.headersSent?response.statusCode:undefined,ms:Math.round(performance.now()-traceStarted),elapsed:Math.round(performance.now()-started),pool:{total:db.pool.totalCount,idle:db.pool.idleCount,waiting:db.pool.waitingCount}});if(trace.length>100)trace.shift();};
      record('request');response.on('finish',()=>record('finish'));response.on('close',()=>record('close'));
    });
    browser = await chromium.launch({headless: true});
    const mailCapture = createMailCapture({pool: db.pool, inbox: process.env.MAILPIT_TEST_URL!, mailer: createLocalAccountMailer({
      port: Number(process.env.MAILPIT_TEST_SMTP_PORT), portalOrigin: origin,
    })});
    const worker = new EmailWorker(db.pool, db.outbox, mailCapture.mailer);
    return {origin, browser, db, issuer,trace,translation:translations,
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
      loseAccountReply(path: string, loss: 'whole'|'body' = 'whole') {
        const server=running!.server;
        const hook = (request:IncomingMessage, response:ServerResponse) => {
          if(request.url!==`/api/account${path}`)return;
          server.removeListener('request',hook);
          response.write=()=>true;
          if(loss==='whole')response.writeHead=()=>response;
          response.end=()=>{
            if(loss==='body'){response.flushHeaders();setTimeout(()=>request.socket.destroy(),50);}
            else request.socket.destroy();
            return response;
          };
        };
        server.prependListener('request',hook);
      },
      mailEvidence: mailCapture.evidence,
      async drainMail() { while (await mailCapture.runOnce(worker)) {} },
      async close() { translations?.close(); await browser?.close(); await running?.close(); await db.close(); },
    };
  } catch (error) { translations?.close(); await browser?.close(); await running?.close(); await db.close(); throw error; }
}
export async function mailFor(email: string, subject: string, evidence?: () => Promise<object>): Promise<string> {
  const inbox = process.env.MAILPIT_TEST_URL!;
  const response = await fetch(`${inbox}/api/v1/messages`);
  const list = await response.json() as {messages: {ID: string; Subject: string; To: {Address: string}[]}[]};
  const found = list.messages.find(message => message.Subject === subject && message.To.some(to => to.Address === email));
  if (!found) {
    let boundaries: object;
    try { boundaries = await evidence?.() ?? {}; } catch { boundaries = {boundaries: 'unavailable'}; }
    const knownSubjects = new Set(['Verify your Waitron Cloud email', 'Verifica tu correo de Waitron Cloud',
      'Reset your Waitron Cloud password', 'Restablece tu contraseña de Waitron Cloud',
      'Your Waitron Cloud password changed', 'Tu contraseña de Waitron Cloud ha cambiado',
      'Waitron Cloud: a venue needs attention', 'Waitron Cloud: un local necesita atención',
      'Waitron Cloud: venue check recovered', 'Waitron Cloud: comprobación recuperada']);
    const metadata = list.messages.slice(0, 50).map(message => ({
      subject: knownSubjects.has(message.Subject) ? message.Subject : 'other',
      recipients: message.To.slice(0, 10).map(to => /^[a-zA-Z0-9_.+-]{1,100}@example\.test$/.test(to.Address) ? to.Address : 'other'),
    }));
    const diagnostic = { ...boundaries, inbox: {status: response.status, listed: list.messages.length,
      subjectMatches: list.messages.filter(message => message.Subject === subject).length,
      recipientMatches: list.messages.filter(message => message.To.some(to => to.Address === email)).length,
      combinedMatches: 0, messages: metadata} };
    assert.ok(found, `Missing ${subject} message. Mail capture: ${JSON.stringify(diagnostic)}`);
  }
  const message = await (await fetch(`${inbox}/api/v1/message/${found.ID}`)).json() as {Text: string};
  return message.Text;
}
