import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CountryReadiness} from '../src/worldwide/countries.ts';
test('country readiness reads only fixed public health URLs without credentials and bounds failed responses', async () => {
  let calls = 0;
  const cases = [new Response('{"status":"ready"}'), new Response('{"status":"ready"}', {status:503}),
    new Response('{}'), new Response('x'.repeat(2049)), new Response(null, {status:302,headers:{location:'https://elsewhere.test'}})];
  const countries = new CountryReadiness({ES:'https://es.example.test'}, async (input, init) => {
    assert.equal(input, 'https://es.example.test/api/health/ready');
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.equal(init?.method, 'GET'); assert.equal(init?.headers, undefined); assert.ok(init?.signal);
    calls++; return cases.shift()!;
  });
  assert.deepEqual(await countries.read(), [{countryCode:'ES',origin:'https://es.example.test',status:'ready'}]);
  for (let n=0;n<4;n++) assert.equal((await countries.read())[0]?.status, 'unavailable');
  assert.equal(calls,5);
  const offline = new CountryReadiness({ES:'https://es.example.test'}, async () => {throw new Error('offline');});
  assert.equal((await offline.read())[0]?.status,'unavailable');
});
test('country origins must be exact HTTPS origins with uppercase country codes', () => {
  for (const config of ([{es:'https://es.example.test'}, {ES:'http://localhost'}, {ES:'https://es.example.test/path'}, {ES:'https://name:secret@es.example.test'}] as Record<string,string>[])) {
    assert.throws(() => new CountryReadiness(config), /Invalid country/);
  }
});
test('an unresponsive country read ends at its deadline', async () => {
  const countries = new CountryReadiness({ES:'https://es.example.test'}, (_input, init) => new Promise((_resolve,reject) => {
    const pending = setTimeout(()=>reject(new Error('Network still pending')),5000);
    init!.signal!.addEventListener('abort',()=>{clearTimeout(pending);reject(new Error('Timed out'));},{once:true});
  }));
  const started = performance.now();
  assert.equal((await countries.read())[0]?.status,'unavailable');
  assert.ok(performance.now()-started < 3500);
});
