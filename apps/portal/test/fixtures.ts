import {generateKeyPairSync} from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { database } from '../../../packages/account-http/test/fixtures.ts';
import { startAccountServer } from '@waitron-cloud/account-http';
import { loadPortalAssets } from '../../../packages/account-http/src/portal.ts';
import { EmailWorker, createLocalAccountMailer, createLeaseIssuer } from '@waitron-cloud/registration';
export async function startPortalFixture() {
  const db = await database();
  const reserved = createServer();
  await new Promise<void>(resolve => reserved.listen(0, '127.0.0.1', resolve));
  const address = reserved.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => reserved.close(() => resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  let running: Awaited<ReturnType<typeof startAccountServer>> | undefined;
  let browser: Browser | undefined;
  try {
    const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
    running = await startAccountServer({leaseIssuer:issuer,pool: db.pool, outbox: db.outbox, port: address.port,
      config: {portalOrigin: origin, production: false, rateKey: db.rateKey, trustedProxyIps: []},
      portalAssets: await loadPortalAssets(new URL('../dist', import.meta.url).pathname)});
    browser = await chromium.launch({headless: true});
    const worker = new EmailWorker(db.pool, db.outbox, createLocalAccountMailer({
      port: Number(process.env.MAILPIT_TEST_SMTP_PORT), portalOrigin: origin,
    }));
    return {origin, browser, db, issuer,
      loseMachineReply(action: string) {
        const server=running!.server;
        const hook: Parameters<typeof server.prependListener>[1] = (request, response) => {
          if(request.url!==`/api/installations/${action}`)return;
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
