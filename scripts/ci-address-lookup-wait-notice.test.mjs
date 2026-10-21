import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

function probe(waitMs, {pause = false} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'address-wait-notice-'));
  try {
    const program = `
      import assert from 'node:assert/strict';
      import {writeFileSync, readFileSync, existsSync} from 'node:fs';
      import {join} from 'node:path';
      import {RequestBudget, EvaluationClient} from ${JSON.stringify(new URL('./address-lookup-evaluation.mjs', import.meta.url).href)};
      const directory = process.argv[1];
      const saved = JSON.stringify({provider:'google', operation:'autocomplete', caseId:'private-saved-marker', ordinal:1, at:new Date(${waitMs}-100).toISOString()})+'\\n';
      writeFileSync(join(directory, 'requests.jsonl'), saved);
      const budget = new RequestBudget(directory);
      let elapsed = 0, timers = 0, calls = 0;
      Date.now = ()=>0;
      performance.now = ()=>elapsed;
      globalThis.setTimeout = (callback, delay)=>{
        assert.ok(++timers<=3, 'wait did not make bounded progress');
        assert.equal(readFileSync(budget.path, 'utf8'), saved, 'wait spent a request before dispatch');
        assert.equal(calls, 0);
        if (${pause}) throw new Error('offline pause');
        elapsed += delay;
        queueMicrotask(callback);
      };
      try {
        const client = new EvaluationClient({budget, directory, keys:{google:'private-key-marker'}, spacingMs:100, fetcher:async()=>{
          calls++;
          assert.ok(elapsed>=${waitMs}, 'notice bypassed the spacing');
          assert.equal(budget.counts.google, 2);
          return new Response('{}');
        }});
        const pending = client.request('google', 'autocomplete', 'private-case-marker', 'private-query-marker');
        if (${pause}) {
          await assert.rejects(pending, /offline pause/);
          assert.equal(calls, 0);
          assert.equal(readFileSync(budget.path, 'utf8'), saved);
          assert.equal(existsSync(join(directory, 'measurements.jsonl')), false);
        } else {
          await pending;
          assert.equal(calls, 1);
          assert.equal(budget.counts.google, 2);
          assert.equal(budget.retries.google, 0);
          assert.equal(client.measurements.length, 1);
        }
      } finally { budget.close(); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, directory], {encoding:'utf8', timeout:5000});
    assert.equal(result.status, 0, JSON.stringify({error:result.error?.message, signal:result.signal, stdout:result.stdout, stderr:result.stderr}));
    assert.equal(result.stdout, '', 'wait notices must leave stdout available for scores and receipts');
    assert.ok(!result.stderr.includes('private-'), 'wait notice leaked request data');
    return result.stderr;
  } finally { rmSync(directory, {recursive:true, force:true}); }
}

test('a paused future-journal wait explains its duration before sleeping without spending a request', () => {
  const notice = probe(60001, {pause:true});
  assert.match(notice, /Waiting 61 seconds/);
  assert.match(notice, /request spacing/);
  assert.match(notice, /future journal timestamps/);
  assert.equal(notice.trim().split('\n').length, 1);
});

test('a multi-chunk wait reports once and still reaches the entire spacing deadline', () => {
  const notice = probe(2592000100);
  assert.match(notice, /Waiting 2592001 seconds/);
  assert.equal(notice.trim().split('\n').length, 1);
});

test('a one-minute wait reports before eventually dispatching', () => {
  assert.match(probe(60000), /Waiting 60 seconds/);
});

test('ordinary waits stay quiet', () => {
  assert.equal(probe(59999), '');
});
