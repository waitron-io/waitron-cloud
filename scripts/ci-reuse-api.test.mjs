import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, writeFileSync, chmodSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const module = await import('./ci-reuse-api.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const repository = 'waitron-io/waitron-cloud';
const head = 'b'.repeat(40);
const response = (body, link = '') => Buffer.from(`HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n${link ? `Link: ${link}\r\n` : ''}\r\n${JSON.stringify(body)}`);
const page = (items, total_count, nextPage = null) => ({items, total_count, nextPage, terminal: nextPage === null});

test('bounded GitHub reader preserves raw identities and exact-attempt endpoint bindings', () => {
  assert.equal(typeof module.createReuseApi, 'function', 'Missing bounded GitHub reader');
  const calls = [];
  const bodies = [{id: 7, full_name: repository, default_branch: 'main'}, {id: 8, path: '.github/workflows/ci.yml'},
    {sha: head, tree: {sha: 'c'.repeat(40)}}, [{id: 9, number: 9}],
    {total_count: 1, workflow_runs: [{id: 42, run_attempt: 2}]}, {id: 42, run_attempt: 2},
    {total_count: 1, jobs: [{id: 15, run_id: 42, run_attempt: 2, head_sha: head}]},
    {total_count: 1, artifacts: [{id: 16, expired: false}]}];
  const api = module.createReuseApi({repository, now: () => 100, execute: (command, args, options) => {
    calls.push({command, args, options});
    return response(bodies.shift());
  }});
  assert.equal(api.readRepository().id, 7);
  assert.equal(api.readWorkflow('.github/workflows/ci.yml').id, 8);
  assert.equal(api.readCommit(head).sha, head);
  assert.deepEqual(api.listAssociatedPRs(head, 1), page([{id: 9, number: 9}], undefined));
  assert.deepEqual(api.listRuns('.github/workflows/ci.yml', head, 1), page([{id: 42, run_attempt: 2}], 1));
  assert.equal(api.readRun(42).run_attempt, 2);
  assert.deepEqual(api.listAttemptJobs(42, 2, 1), page([{id: 15, run_id: 42, run_attempt: 2, head_sha: head}], 1));
  assert.deepEqual(api.listArtifacts(42, 1), page([{id: 16, expired: false}], 1));
  assert.deepEqual(calls.map(call => call.args.at(-1)), [
    `repos/${repository}`, `repos/${repository}/actions/workflows/ci.yml`, `repos/${repository}/git/commits/${head}`,
    `repos/${repository}/commits/${head}/pulls?per_page=100&page=1`,
    `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100&page=1`,
    `repos/${repository}/actions/runs/42`, `repos/${repository}/actions/runs/42/attempts/2/jobs?per_page=30&page=1`,
    `repos/${repository}/actions/runs/42/artifacts?per_page=100&page=1`,
  ]);
  assert.ok(calls.every(call => call.options.timeout === 5000 && call.options.killSignal === 'SIGKILL'));
});

test('all pages are required, including a newer red run on the second page', () => {
  assert.equal(typeof module.collectPages, 'function', 'Missing complete page collector');
  const first = Array.from({length: 100}, (_, index) => ({id: index + 1, conclusion: 'success'}));
  const pages = [page(first, 101, 2), page([{id: 101, conclusion: 'failure'}], 101)];
  const items = module.collectPages(number => pages[number - 1]);
  assert.equal(items.length, 101);
  assert.equal(items.at(-1).conclusion, 'failure');
  assert.deepEqual(module.collectPages(() => page([], 0)), []);
  for (const bad of [
    [page(first, 101, 2), undefined],
    [page(first, 101, 2), page([{id: 101}], 102)],
    [page(first, 101, 2), page([{id: 1}], 101)],
    [page(first, 101, 1), page([{id: 101}], 101)],
    [{...page(first, 100), terminal: false}],
    [page(first, 101)],
    [page([], 1, 2)],
    [page([{id: 0}], 1)],
    [page([{id: 1}], 1000)],
  ]) assert.throws(() => module.collectPages(number => bad[number - 1]));
  let reads = 0;
  assert.throws(() => module.collectPages(number => {
    reads++;
    return page(Array.from({length: 100}, (_, index) => ({id: (number - 1) * 100 + index + 1})), undefined, number + 1);
  }), /page limit/i);
  assert.equal(reads, 5);
});

test('pagination follows only the same endpoint with consecutive page identity', () => {
  assert.equal(typeof module.createReuseApi, 'function', 'Missing bounded GitHub reader');
  const endpoint = `https://api.github.com/repos/${repository}/actions/runs/42/attempts/2/jobs?per_page=30&page=2`;
  let link = `<${endpoint}>; rel="next"`;
  const api = module.createReuseApi({repository, execute: () => response({total_count: 101, jobs: [{id: 1}]}, link)});
  assert.equal(api.listAttemptJobs(42, 2, 1).nextPage, 2);
  for (const invalid of [endpoint.replace('api.github.com', 'attacker.invalid'), endpoint.replace('/42/', '/43/'),
    endpoint.replace('page=2', 'page=1'), endpoint + '&filter=latest']) {
    link = `<${invalid}>; rel="next"`;
    assert.throws(() => api.listAttemptJobs(42, 2, 1));
  }
  link = `<${endpoint}>; rel="next", <${endpoint}>; rel="next"`;
  assert.throws(() => api.listAttemptJobs(42, 2, 1));
});

test('the CLI mixed newline header format retains a first Link header', () => {
  const endpoint = `https://api.github.com/repos/${repository}/actions/runs/42/artifacts?per_page=100&page=2`;
  const api = module.createReuseApi({repository, execute: () => Buffer.from(
    `HTTP/2.0 200 OK\nLink: <${endpoint}>; rel="next"\r\nContent-Type: application/json\r\n\r\n{"total_count":101,"artifacts":[{"id":1}]}`)});
  assert.equal(api.listArtifacts(42, 1).nextPage, 2);
});

test('Git subprocess and batch reads share the remaining deadline and five-second command bound', () => {
  assert.equal(typeof module.createBoundedGit, 'function', 'Missing bounded Git reader');
  let time = 800, calls = [];
  const git = module.createBoundedGit({remaining: () => time, execute: (command, args, options) => {
    calls.push({command, args, options});
    if (args[0] === 'cat-file') return Buffer.from('');
    return options.encoding === 'utf8' ? head + '\n' : Buffer.from(head + '\n');
  }});
  assert.equal(git('rev-parse', 'HEAD').trim(), head);
  assert.ok(Buffer.isBuffer(git('show', `${head}:package.json`, {binary: true})));
  assert.deepEqual([...git.readBlobs([])], []);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.command === 'git' && call.options.timeout === 800 && call.options.killSignal === 'SIGKILL'));
  time = 12_000; git('rev-parse', 'HEAD'); assert.equal(calls.at(-1).options.timeout, 5000);
  time = 0; assert.throws(() => git('rev-parse', 'HEAD'), /deadline/i);
  assert.equal(calls.length, 3);
  time = 500;
  const late = module.createBoundedGit({remaining: () => time, execute: () => {time = 0; return head;}});
  assert.throws(() => late('rev-parse', 'HEAD'), /deadline/i);
  const batch = module.createBoundedGit({remaining: () => 600, execute: (command, args, options) => {
    assert.equal(command, 'git'); assert.deepEqual(args, ['cat-file', '--batch']);
    assert.equal(options.timeout, 600); assert.equal(options.input, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\n');
    return Buffer.from('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 blob 0\n\n');
  }});
  assert.equal(batch.readBlobs(['e69de29bb2d1d6434b8b29ae775ad8c2e48c5391']).get('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'), '');
});

test('30 requests, 30 seconds overall and five seconds per command are hard limits', () => {
  assert.equal(typeof module.createReuseApi, 'function', 'Missing bounded GitHub reader');
  let time = 0, calls = 0, timeout;
  const api = module.createReuseApi({repository, now: () => time, execute: (_command, _args, options) => {
    calls++; timeout = options.timeout; return response({id: 1});
  }});
  for (let index = 0; index < 30; index++) api.readRepository();
  assert.throws(() => api.readRepository(), /request budget/i);
  assert.equal(calls, 30);
  const timed = module.createReuseApi({repository, now: () => time, execute: (_command, _args, options) => {
    calls++; timeout = options.timeout; return response({id: 1});
  }});
  time = 28_750;
  timed.readRepository();
  assert.equal(timeout, 1250);
  timed.readRepository(600);
  assert.equal(timeout, 600);
  time = 30_000;
  assert.throws(() => timed.readRepository(), /deadline/i);
  assert.equal(calls, 32);
  time = 0;
  const late = module.createReuseApi({repository, now: () => time, execute: () => {time = 30_001; return response({id: 1});}});
  assert.throws(() => late.readRepository(), /deadline/i);
});

test('malformed responses, unsafe identifiers and oversized binary reads never become evidence', () => {
  assert.equal(typeof module.createReuseApi, 'function', 'Missing bounded GitHub reader');
  let body = Buffer.from('HTTP/2.0 500 Error\r\n\r\n{}'), calls = 0;
  const api = module.createReuseApi({repository, execute: () => {calls++; return body;}});
  for (const invalid of [body, Buffer.from('HTTP/2.0 500 Error\r\n\r\n{"total_count":0,"workflow_runs":[]}'), Buffer.from('{}'), Buffer.from('HTTP/2.0 200 OK\r\n\r\n{'),
    response({total_count: 1})]) {
    body = invalid;
    assert.throws(() => api.listRuns('.github/workflows/ci.yml', head, 1));
  }
  const before = calls;
  for (const operation of [() => api.readWorkflow('../ci.yml'), () => api.readCommit('--help'), () => api.readRun(0),
    () => api.listAttemptJobs(42, 0, 1), () => api.listArtifacts(42, 6), () => api.readPlanArtifact(-1)]) assert.throws(operation);
  assert.equal(calls, before);
  body = Buffer.alloc(256 * 1024 + 2049);
  assert.throws(() => api.readPlanArtifact(16), /size/i);
  body = Buffer.from([0x50, 0x4b, 0x00, 0xff]);
  assert.deepEqual(api.readPlanArtifact(16), body);
});

test('real subprocess consumes a fake gh response and kills only its own timed-out command', () => {
  assert.equal(typeof module.createReuseApi, 'function', 'Missing bounded GitHub reader');
  const root = mkdtempSync(join(tmpdir(), 'cloud-reuse-api-'));
  try {
    const executable = join(root, 'gh');
    writeFileSync(executable, `#!/usr/bin/env node\nif (process.argv.includes('repos/${repository}')) process.stdout.write(${JSON.stringify(response({id: 7}).toString())}); else setTimeout(() => {}, 10000);\n`);
    chmodSync(executable, 0o700);
    const api = module.createReuseApi({repository, executable});
    assert.equal(api.readRepository().id, 7);
    assert.throws(() => api.readRun(42, 50), error => error.code === 'ETIMEDOUT');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('job-publication reads consume only the summary time remaining', () => {
  let time = 0, observed;
  const api = module.createReuseApi({repository, budgetMs: 37, now: () => time, execute: (_command, _args, options) => {
    observed = options.timeout; time += 38; return response({id: 42});
  }});
  assert.throws(() => api.readRun(42), /deadline exhausted/);
  assert.equal(observed, 37);
});

test('a short nonterminal page refuses evidence even when later pages can reach the declared total', () => {
  const first = Array.from({length: 99}, (_, i) => ({id: i + 1}));
  assert.throws(() => module.collectPages(number => number === 1 ? page(first, 100, 2) : page([{id: 100}], 100)), /Truncated nonterminal page/);
});

test('duplicate Link headers cannot silently select only the first pagination instruction', () => {
  const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100&page=2`;
  const api = module.createReuseApi({repository, execute: () => response({total_count: 100, workflow_runs: [{id: 42}]},
    `<${endpoint}>; rel="next"\r\nLink: <${endpoint}>; rel="last"`)});
  assert.throws(() => api.listRuns('.github/workflows/ci.yml', head, 1), /Duplicate pagination headers/);
});

test('current job reads bind to their own repository without relaxing reuse repository admission', () => {
  assert.equal(typeof module.createCurrentJobReader, 'function');
  const calls = [];
  const read = module.createCurrentJobReader({repository: 'someone/waitron-cloud', runId: 42, attempt: 2,
    execute: (_command, args, options) => {calls.push({args, options}); return response({total_count: 1, jobs: [{id: 1}]});}});
  assert.deepEqual(read(123), [{id: 1}]);
  assert.equal(calls[0].args.at(-1), 'repos/someone/waitron-cloud/actions/runs/42/attempts/2/jobs?per_page=30&page=1');
  assert.ok(calls[0].options.timeout <= 123);
  assert.throws(() => module.createReuseApi({repository: 'someone/waitron-cloud'}), /Unsupported evidence repository/);
});


test('small job pages retain the 500-record ceiling and reject incomplete or changing inventories', () => {
  const jobs = Array.from({length: 500}, (_, i) => ({id: i + 1}));
  let mode = 'complete', reads = 0;
  const read = module.createCurrentJobReader({repository, runId: 42, attempt: 2, now: () => 0,
    execute: (_command, args) => {
      reads++;
      const url = new URL(`https://api.github.com/${args.at(-1)}`);
      const size = Number(url.searchParams.get('per_page')), number = Number(url.searchParams.get('page'));
      if (size > 30) throw Object.assign(Error('Large jobs page times out'), {code: 'ETIMEDOUT'});
      let items = jobs.slice((number - 1) * size, number * size);
      if (number === 2 && mode === 'duplicate') items[0] = jobs[0];
      if (number === 2 && mode === 'short') items.pop();
      let total = mode === 'over-limit' ? 501 : 500;
      if (number === 2 && mode === 'changed') total--;
      const next = number * size < total && mode !== 'terminal';
      url.searchParams.set('page', String(number + 1));
      return response({total_count: total, jobs: items}, next ? `<${url}>; rel="next"` : '');
    }});
  assert.deepEqual(read(30_000), jobs);
  assert.equal(reads, 17);
  for (const [value, error] of [['duplicate', /Duplicate/], ['short', /Truncated/],
    ['changed', /total changed/], ['terminal', /Incomplete/], ['over-limit', /Unsupported list total/]]) {
    mode = value;
    assert.throws(() => read(30_000), error);
  }
});


test('numeric repository pagination is bound to the independently verified named repository', () => {
  const jobs = Array.from({length: 31}, (_, i) => ({id: i + 1}));
  let linkedId = 123, returned = {id: 123, full_name: repository};
  const read = () => {
    const api = module.createReuseApi({repository, execute: (_command, args) => {
      const endpoint = args.at(-1);
      if (endpoint === `repos/${repository}`) return response(returned);
      const url = new URL(`https://api.github.com/${endpoint}`), number = Number(url.searchParams.get('page'));
      assert.equal(url.pathname, `/repos/${repository}/actions/runs/42/attempts/2/jobs`);
      return response({total_count: 31, jobs: jobs.slice((number - 1) * 30, number * 30)}, number === 1
        ? `<https://api.github.com/repositories/${linkedId}/actions/runs/42/attempts/2/jobs?per_page=30&page=2>; rel="next"` : '');
    }});
    return module.collectJobPages(number => api.listAttemptJobs(42, 2, number));
  };
  assert.deepEqual(read(), jobs);
  linkedId = 124;
  assert.throws(read, /repository/i);
  linkedId = 123; returned = {id: 123, full_name: 'someone/other-repository'};
  assert.throws(read, /repository/i);
  for (const id of ['123', [123], 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    returned = {id, full_name: repository};
    assert.throws(read, /Invalid numeric identity/);
  }
});


test('job page and list bounds hold without declared totals', () => {
  const records = count => Array.from({length: count}, (_, i) => ({id: i + 1}));
  assert.throws(() => module.collectJobPages(() => page(records(31), undefined)), /malformed page/i);
  const read = number => page(records(number === 17 ? 20 : 30).map(item => ({id: (number - 1) * 30 + item.id})),
    undefined, number === 17 ? null : number + 1);
  assert.equal(module.collectJobPages(read).length, 500);
  assert.throws(() => module.collectJobPages(number => number < 17 ? read(number)
    : page(records(30).map(item => ({id: 480 + item.id})), undefined)), /record limit/i);
  for (const invalid of [0, -1, 101, 1.5, NaN]) {
    assert.throws(() => module.collectPages(() => page([], 0), invalid), /Invalid page size/);
  }
});


test('numeric pagination keeps exact link checks and caches only verified repository identity', () => {
  const endpoint = `https://api.github.com/repositories/123/actions/runs/42/attempts/2/jobs?per_page=30&page=2`;
  let link = endpoint, record = {id: 123, full_name: repository}, reads = 0;
  const execute = (_command, args) => {
    if (args.at(-1) === `repos/${repository}`) {reads++; return response(record);}
    return response({total_count: 31, jobs: Array.from({length: 30}, (_, i) => ({id: i + 1}))}, `<${link}>; rel="next"`);
  };
  for (const invalid of [endpoint.replace('api.github.com', 'foreign.invalid'), endpoint.replace('/42/', '/43/'),
    endpoint.replace('/attempts/2/', '/attempts/3/'), endpoint.replace('page=2', 'page=3'),
    endpoint.replace('per_page=30', 'per_page=100'), endpoint + '&filter=latest', endpoint + '#fragment']) {
    link = invalid;
    const api = module.createReuseApi({repository, execute});
    assert.throws(() => api.listAttemptJobs(42, 2, 1), /Foreign or nonconsecutive/);
  }
  link = endpoint.replace('/123/', '/999/'); record = {id: 999, full_name: 'someone/other'}; reads = 0;
  const api = module.createReuseApi({repository, execute});
  assert.throws(() => api.listAttemptJobs(42, 2, 1), /repository name differs/);
  record = {id: 123, full_name: repository};
  assert.throws(() => api.listAttemptJobs(42, 2, 1), /repository identity differs/);
  assert.equal(reads, 2, 'A refused repository record must not be cached');
});

test('numeric pagination reads repository identity once across the complete 500-job inventory', () => {
  const jobs = Array.from({length: 500}, (_, i) => ({id: i + 1}));
  let reads = 0, changed = false;
  const api = module.createReuseApi({repository, execute: (_command, args) => {
    const endpoint = args.at(-1);
    if (endpoint === `repos/${repository}`) {reads++; return response({id: 123, full_name: repository});}
    const number = Number(new URL(`https://api.github.com/${endpoint}`).searchParams.get('page'));
    return response({total_count: 500, jobs: jobs.slice((number - 1) * 30, number * 30)}, number < 17
      ? `<https://api.github.com/repositories/${changed && number === 2 ? 124 : 123}/actions/runs/42/attempts/2/jobs?per_page=30&page=${number + 1}>; rel="next"` : '');
  }});
  assert.deepEqual(module.collectJobPages(number => api.listAttemptJobs(42, 2, number)), jobs);
  assert.equal(reads, 1);
  changed = true;
  assert.throws(() => api.listAttemptJobs(42, 2, 2), /repository identity differs/);
  assert.equal(reads, 1);
});

test('numeric pagination identity lookup consumes the caller budget left after reading the page', () => {
  let time = 0, observed;
  const api = module.createReuseApi({repository, now: () => time, execute: (_command, args, options) => {
    if (args.at(-1) === `repos/${repository}`) {
      observed = options.timeout;
      time += 900;
      return response({id: 123, full_name: repository});
    }
    time += 4000;
    return response({total_count: 31, jobs: Array.from({length: 30}, (_, i) => ({id: i + 1}))},
      '<https://api.github.com/repositories/123/actions/runs/42/attempts/2/jobs?per_page=30&page=2>; rel="next"');
  }});
  assert.equal(api.listAttemptJobs(42, 2, 1, 5000).nextPage, 2);
  assert.equal(observed, 1000);
  assert.equal(time, 4900);
});
