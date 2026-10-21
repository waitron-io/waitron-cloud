import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

function probe(body, expectNotice = false) {
  const directory = mkdtempSync(join(tmpdir(), 'address-clock-'));
  try {
    const program = `
      import assert from 'node:assert/strict';
      import {writeFileSync, readFileSync, existsSync} from 'node:fs';
      import {join} from 'node:path';
      import {RequestBudget, EvaluationClient} from ${JSON.stringify(new URL('./address-lookup-evaluation.mjs', import.meta.url).href)};
      const directory = process.argv[1];
      const seed = at => writeFileSync(join(directory, 'requests.jsonl'), JSON.stringify({provider:'google', operation:'autocomplete', caseId:'saved', ordinal:1, at:new Date(at).toISOString()})+'\\n');
      let budget;
      try { ${body} } finally { budget?.close(); }
      process.exit(0);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, directory], {encoding:'utf8', timeout:5000});
    assert.equal(result.status, 0, JSON.stringify({error:result.error?.message, signal:result.signal, stdout:result.stdout, stderr:result.stderr}));
    if (expectNotice) assert.match(result.stderr, /^Waiting \d+ seconds for address-evaluation request spacing; check for future journal timestamps\.\n$/);
    else assert.equal(result.stderr, '');
  } finally { rmSync(directory, {recursive:true, force:true}); }
}

test('a journal timestamp thirty days ahead cannot overflow into an immediate request', () => {
  probe(`
    seed(Date.now()+30*24*60*60*1000);
    budget = new RequestBudget(directory);
    const original = readFileSync(budget.path, 'utf8');
    let calls = 0;
    const client = new EvaluationClient({budget, directory, keys:{google:'offline-key'}, spacingMs:100, fetcher:async()=>{calls++; return new Response('{}');}});
    const pending = client.request('google', 'autocomplete', 'next', 'Madrid');
    await new Promise(resolve=>setTimeout(resolve, 100));
    assert.equal(calls, 0, 'future journal dispatched early');
    assert.equal(readFileSync(budget.path, 'utf8'), original);
    assert.equal(budget.counts.google, 1);
    assert.equal(client.measurements.length, 0);
    assert.equal(existsSync(join(directory, 'measurements.jsonl')), false);
  `, true);
});

for (const shift of [5000, -1000]) {
  test(`wall-clock change ${shift}ms preserves initial and sequential request spacing`, () => {
    probe(`
      budget = new RequestBudget(directory);
      const wallNow = Date.now.bind(Date);
      const arrivals = [];
      const start = performance.now();
      const client = new EvaluationClient({budget, directory, keys:{google:'offline-key'}, spacingMs:100, fetcher:async()=>{arrivals.push(performance.now()); return new Response('{}');}});
      Date.now = ()=>wallNow()+${shift};
      await client.request('google', 'autocomplete', 'one', 'Madrid');
      Date.now = ()=>wallNow()+${2*shift};
      await client.request('google', 'autocomplete', 'two', 'Madrid');
      assert.ok(arrivals[0]-start>=90, 'clock change bypassed initial spacing');
      assert.ok(arrivals[1]-arrivals[0]>=90, 'clock change bypassed sequential spacing');
      assert.ok(arrivals[1]-start<1500, 'clock change extended the spacing');
      assert.equal(budget.counts.google, 2);
      assert.equal(budget.retries.google, 0);
      assert.equal(client.measurements.length, 2);
    `);
  });
}

test('an ordinary future journal timestamp delays then permits a durably reserved request', () => {
  probe(`
    const future = Date.now()+500;
    seed(future);
    budget = new RequestBudget(directory);
    let calls = 0;
    const client = new EvaluationClient({budget, directory, keys:{google:'offline-key'}, spacingMs:100, fetcher:async()=>{
      calls++;
      assert.ok(Date.now()>=future+90, 'future timestamp was ignored');
      assert.equal(budget.counts.google, 2);
      assert.equal(JSON.parse(readFileSync(budget.path, 'utf8').trim().split('\\n').at(-1)).caseId, 'next');
      return new Response('{}');
    }});
    await client.request('google', 'autocomplete', 'next', 'Madrid');
    assert.equal(calls, 1);
    assert.equal(budget.retries.google, 0);
  `);
});

test('a long journal wait reaches its deadline before spending another request', () => {
  probe(`
    seed(2592000000);
    budget = new RequestBudget(directory);
    let elapsed = 0, timers = 0;
    Date.now = ()=>0;
    performance.now = ()=>elapsed;
    globalThis.setTimeout = (callback, delay)=>{
      assert.ok(++timers<=8, 'wait does not make bounded progress');
      // Model Node's overflow and integer truncation without waiting thirty days.
      elapsed += delay>2147483647 ? 1 : Math.max(1, Math.trunc(delay));
      queueMicrotask(callback);
    };
    let calls = 0;
    const client = new EvaluationClient({budget, directory, keys:{google:'offline-key'}, spacingMs:100, fetcher:async()=>{
      calls++;
      return new Response('{}');
    }});
    await client.request('google', 'autocomplete', 'next', 'Madrid');
    assert.ok(elapsed>=2592000100, 'long wait dispatched early');
    assert.equal(budget.counts.google, 2);
    assert.equal(calls, 1);
    assert.equal(budget.retries.google, 0);
  `, true);
});
