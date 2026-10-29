import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {instrumentBrowser} from './instrument.mjs';

// Without stable identities, an old page's unfinished read can be confused with a new stream.
test('generated browser observations retain each request identity and closed path category', async t => {
  const root = mkdtempSync(join(tmpdir(), 'd201-request-identity-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const trace = join(root, 'trace.jsonl');
  writeFileSync(join(root, 'remote.mjs'), readFileSync(new URL('../remote.mjs', import.meta.url)));
  writeFileSync(join(root, 'browser.mjs'), instrumentBrowser(readFileSync(new URL('../browser.mjs', import.meta.url), 'utf8'),
    {compact:true, application:true}).replaceAll('/tmp/cost-browser-trace.jsonl', trace));
  const {measureRemoteBrowser} = await import(pathToFileURL(join(root, 'browser.mjs')));
  const events = new Map();
  const request = path => ({url:() => 'https://staff.generated.example.test' + path,
    resourceType:() => 'fetch', sizes:async () => ({requestBodySize:0,responseBodySize:4})});
  const first = request('/management-api/alerts?PRIVATE_QUERY'), second = request('/management-api/events?PRIVATE_INTERESTS');
  const context = {on:(event, action) => events.set(event, action), async addInitScript() {}, async newPage() {
    for (const req of [first, second]) {
      events.get('request')(req);
      events.get('response')({request:() => req, url:req.url, status:() => 200});
    }
    events.get('requestfinished')(first);
    throw Error('Stop the observation probe');
  }};
  await assert.rejects(measureRemoteBrowser({chromium:{async launch() {return {async newContext() {return context;}, async close() {}};}},
    staffHostname:'staff.generated.example.test',email:'generated@example.test',password:'generated'}),
  {message:'Invalid cloud cost browser journey'});
  const rows = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse).filter(row => row.event === 'request');
  assert.deepEqual(rows.map(row => row.request), [1,1,2,2,1]);
  assert.deepEqual(rows.map(row => row.category), ['alerts','alerts','live','live','alerts']);
  assert.ok(rows.every(row => row.resource === 'fetch'));
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|https:|staff\.generated/);
});
