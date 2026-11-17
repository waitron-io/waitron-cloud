import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {initializeConsole, ConsoleAuth} from '../src/worldwide/auth.ts';
import {createConsoleApp} from '../src/worldwide/app.ts';
import {CountryReadiness} from '../src/worldwide/countries.ts';
import {worldwideDatabase} from './worldwide-fixture.ts';
const direct={incoming:{socket:{remoteAddress:'192.0.2.123'}}} as never;
test('console health needs an admin session; country authority routes are absent and writes require origin and CSRF', async t => {
  const db = await worldwideDatabase(); t.after(() => db.close()); await initializeConsole(db.pool);
  const origin = 'https://console.example.test'; const auth = new ConsoleAuth(db.pool, origin);
  await auth.admin('create','Admin');
  const id = (await db.pool.query('SELECT id FROM cloud_accounts')).rows[0].id;
  const session = await transaction(db.pool, client => createSession(client,id));
  const countries = new CountryReadiness({ES:'https://es.example.test'}, async () => new Response('{"status":"ready"}'));
  const app = createConsoleApp({auth,countries,rateKey:'ab'.repeat(32)});
  const cookie = `__Host-cloud_session=${session.token}`;
  const send = (path: string, headers: Record<string,string> = {}, method='GET') => app.request(origin+path,{method,headers},direct);
  assert.equal((await send('/api/console/countries')).status,401);
  assert.equal((await send('/api/console/countries',{cookie:'__Host-cloud_session='+'c'.repeat(43)})).status,401);
  const response = await send('/api/console/countries',{cookie});
  assert.equal(response.status,200); assert.deepEqual(await response.json(),[{countryCode:'ES',origin:'https://es.example.test',status:'ready'}]);
  assert.equal(response.headers.get('cache-control'),'no-store');
  for (const path of ['/api/account/signup','/api/account/operator/venues','/api/console/deploy']) assert.equal((await send(path,{cookie})).status,404);
  assert.equal((await send('/api/console/signout',{cookie,origin:'https://evil.example.test','x-csrf-token':session.csrfToken},'POST')).status,403);
  assert.equal((await send('/api/console/signout',{cookie,origin},'POST')).status,403);
  assert.equal((await send('/api/console/signout',{cookie,origin,'x-csrf-token':session.csrfToken},'POST')).status,204);
  assert.equal((await send('/api/console/session',{cookie})).status,401);
  assert.equal((await app.request('https://wrong.example.test/',{},direct)).status,403);
});
test('console serves its own external entry under CSP and rate-limits unauthenticated ceremonies', async t => {
  const db = await worldwideDatabase(); t.after(() => db.close()); await initializeConsole(db.pool);
  const origin = 'https://console.example.test'; const auth = new ConsoleAuth(db.pool,origin);
  const app = createConsoleApp({auth,rateKey:'ab'.repeat(32),countries:new CountryReadiness({ES:'https://es.example.test'}),
    assets:new Map([['/worldwide.js',{body:new TextEncoder().encode('console.log(1)'),contentType:'text/javascript'}]])});
  const page = await app.request(origin+'/',{},direct); assert.equal(page.status,200);
  assert.match(await page.text(),/src="\/worldwide.js"/); assert.match(page.headers.get('content-security-policy')!,/script-src 'self'/);
  assert.equal((await app.request(origin+'/app.js',{},direct)).status,404);
  for(let n=0;n<20;n++) assert.equal((await app.request(origin+'/api/console/signin/options',{method:'POST',headers:{origin}},direct)).status,200);
  const limited = await app.request(origin+'/api/console/signin/options',{method:'POST',headers:{origin}},direct);
  assert.equal(limited.status,429); assert.ok(Number(limited.headers.get('retry-after'))>0);
});
test('the loopback TLS proxy preserves separate caller allowances; other peers cannot forge them', async t => {
  const db=await worldwideDatabase();t.after(()=>db.close());await initializeConsole(db.pool);
  const origin='https://console.example.test';const auth=new ConsoleAuth(db.pool,origin);
  const app=createConsoleApp({auth,countries:new CountryReadiness({ES:'https://es.example.test'}),rateKey:'ab'.repeat(32)});
  const send=(forwarded:string,peer='127.0.0.1')=>app.request(origin+'/api/console/signin/options',
    {method:'POST',headers:{origin,'x-forwarded-for':forwarded}}, {incoming:{socket:{remoteAddress:peer}}} as never);
  for(let n=0;n<20;n++) assert.equal((await send('198.51.100.1')).status,200);
  assert.equal((await send('198.51.100.1')).status,429);
  assert.equal((await send('198.51.100.2')).status,200);
  for(let n=0;n<20;n++) assert.equal((await send(`203.0.113.${n}`,'192.0.2.1')).status,200);
  assert.equal((await send('203.0.113.99','192.0.2.1')).status,429);
});
