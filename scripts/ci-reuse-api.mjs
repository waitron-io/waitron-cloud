import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {workflowPaths} from './ci-reuse-proof.mjs';
import {readGitBlobs} from './ci-package-revisions.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const revision = value => assert.match(value, /^(?!0{40}$)[a-f0-9]{40}$/, 'Invalid commit identity');
const identity = value => assert.ok(positive(value), 'Invalid numeric identity');
const pageIdentity = (value, pageSize) => assert.ok(positive(value) && value <= Math.ceil(500 / pageSize), 'Invalid page identity');
const binaryLimit = 256 * 1024 + 2048;

export function collectPages(readPage, pageSize = 100) {
  assert.ok(positive(pageSize) && pageSize <= 100, 'Invalid page size');
  const items = [], ids = new Set();
  let total;
  for (let number = 1; number <= Math.ceil(500 / pageSize); number++) {
    const page = readPage(number);
    assert.ok(page && Array.isArray(page.items) && page.items.length <= pageSize, 'Missing or malformed page');
    assert.equal(typeof page.terminal, 'boolean', 'Missing terminal-page proof');
    assert.equal(page.terminal, page.nextPage === null, 'Conflicting terminal-page proof');
    if (page.total_count !== undefined) {
      assert.ok(Number.isSafeInteger(page.total_count) && page.total_count >= 0 && page.total_count <= 500, 'Unsupported list total or search limit');
    }
    if (number === 1) total = page.total_count;
    else assert.equal(page.total_count, total, 'List total changed between pages');
    for (const item of page.items) {
      assert.ok(positive(item?.id) && !ids.has(item.id), 'Duplicate or invalid list identity');
      ids.add(item.id);
      items.push(item);
    }
    assert.ok(items.length <= 500, 'Evidence record limit exceeded');
    if (total !== undefined) assert.ok(items.length <= total, 'List exceeds declared total');
    if (page.terminal) {
      if (total !== undefined) assert.equal(items.length, total, 'Incomplete terminal page');
      return items;
    }
    assert.equal(page.nextPage, number + 1, 'Nonconsecutive or cyclic next page');
    assert.equal(page.items.length, pageSize, 'Truncated nonterminal page');
  }
  throw Error('Evidence page limit exceeded');
}

// Smaller job pages reduce response size within the unchanged lookup deadlines.
export const collectJobPages = readPage => collectPages(readPage, 30);

export function createReuseApi(options = {}) {
  assert.equal(options.repository, 'waitron-io/waitron-cloud', 'Unsupported evidence repository');
  return createGithubReader(options);
}

function createGithubReader({repository, now = () => performance.now(), execute = execFileSync, executable = 'gh', budgetMs = 30_000} = {}) {
  assert.ok(typeof repository === 'string' && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) &&
    !['.', '..'].includes(repository.split('/')[1]), 'Invalid current repository');
  assert.ok(Number.isFinite(budgetMs) && budgetMs > 0 && budgetMs <= 30_000, 'Invalid evidence deadline');
  const deadline = now() + budgetMs;
  let requests = 0, repositoryId;
  const remaining = () => {
    const value = Math.floor(deadline - now());
    assert.ok(Number.isFinite(value) && value > 0, 'Evidence deadline exhausted');
    return value;
  };
  const read = (endpoint, remainingMs = remaining(), binary = false) => {
    assert.ok(Number.isFinite(remainingMs) && remainingMs > 0, 'Invalid remaining deadline');
    assert.ok(requests < 30, 'Evidence request budget exhausted');
    const timeout = Math.floor(Math.min(5000, remaining(), remainingMs));
    assert.ok(timeout > 0, 'Evidence deadline exhausted');
    requests++;
    const args = ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
    if (!binary) args.push('--include');
    args.push(endpoint);
    const bytes = execute(executable, args, {timeout, killSignal: 'SIGKILL', encoding: null,
      maxBuffer: binary ? binaryLimit : 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
    remaining();
    assert.ok(Buffer.isBuffer(bytes) && bytes.length <= (binary ? binaryLimit : 4 * 1024 * 1024), 'Invalid evidence response size');
    if (binary) return bytes;
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    const separator = /\r?\n\r?\n/.exec(text);
    assert.ok(separator && separator.index > 0, 'Missing HTTP response headers');
    const headers = text.slice(0, separator.index).split(/\r?\n/);
    assert.match(headers.shift(), /^HTTP\/[\d.]+ 200(?: |$)/, 'Unsuccessful HTTP evidence response');
    const links = headers.filter(header => /^link:/i.test(header));
    assert.ok(links.length <= 1, 'Duplicate pagination headers');
    return {body: JSON.parse(text.slice(separator.index + separator[0].length)), link: links[0]?.slice(5).trim()};
  };
  const object = (endpoint, remainingMs) => {
    const {body} = read(endpoint, remainingMs);
    assert.ok(body && typeof body === 'object' && !Array.isArray(body), 'Missing evidence object');
    return body;
  };
  const list = (endpoint, key, number, remainingMs) => {
    const lookupDeadline = now() + (remainingMs ?? remaining());
    const pageSize = key === 'jobs' ? 30 : 100;
    pageIdentity(number, pageSize);
    const target = `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=${pageSize}&page=${number}`;
    const {body, link} = read(target, remainingMs);
    const items = key ? body?.[key] : body;
    assert.ok(Array.isArray(items), 'Missing evidence page items');
    if (key) assert.ok(Number.isSafeInteger(body.total_count) && body.total_count >= 0, 'Missing evidence page total');
    let nextPage = null;
    if (link) {
      const next = [];
      for (const entry of link.split(',')) {
        const match = entry.trim().match(/^<([^>]+)>;\s*rel="(next|prev|first|last)"$/);
        assert.ok(match, 'Malformed pagination link');
        if (match[2] === 'next') next.push(match[1]);
      }
      assert.ok(next.length <= 1, 'Duplicate next-page link');
      if (next.length) {
        const expected = new URL(`https://api.github.com/${target}`);
        expected.searchParams.set('page', String(number + 1));
        const actual = new URL(next[0]);
        const numeric = actual.pathname.match(/^\/repositories\/([1-9][0-9]*)\//);
        if (numeric) {
          if (repositoryId === undefined) {
            const record = object(root, Math.floor(lookupDeadline - now()));
            assert.equal(record.full_name, repository, 'Pagination repository name differs');
            identity(record.id);
            repositoryId = record.id;
          }
          assert.equal(numeric[1], String(repositoryId), 'Pagination repository identity differs');
          // GitHub emits numeric repository aliases; every request still uses the named endpoint.
          actual.pathname = actual.pathname.replace(/^\/repositories\/[1-9][0-9]*\//, `/repos/${repository}/`);
        }
        actual.searchParams.sort();
        expected.searchParams.sort();
        assert.equal(actual.href, expected.href, 'Foreign or nonconsecutive next-page link');
        nextPage = number + 1;
      }
    }
    return {items, total_count: key ? body.total_count : undefined, nextPage, terminal: nextPage === null};
  };
  const workflow = path => {
    assert.ok(workflowPaths.includes(path), 'Unsupported evidence workflow');
    return path.slice('.github/workflows/'.length);
  };
  const root = `repos/${repository}`;
  return {
    remaining,
    readRepository: remainingMs => object(root, remainingMs),
    readWorkflow: (path, remainingMs) => object(`${root}/actions/workflows/${workflow(path)}`, remainingMs),
    readCommit: (sha, remainingMs) => {revision(sha); return object(`${root}/git/commits/${sha}`, remainingMs);},
    listAssociatedPRs: (sha, number, remainingMs) => {revision(sha); return list(`${root}/commits/${sha}/pulls`, null, number, remainingMs);},
    listRuns: (path, head, number, remainingMs) => {revision(head); return list(`${root}/actions/workflows/${workflow(path)}/runs?head_sha=${head}&event=pull_request`, 'workflow_runs', number, remainingMs);},
    readRun: (runId, remainingMs) => {identity(runId); return object(`${root}/actions/runs/${runId}`, remainingMs);},
    listAttemptJobs: (runId, attempt, number, remainingMs) => {
      identity(runId); identity(attempt);
      return list(`${root}/actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs', number, remainingMs);
    },
    listArtifacts: (runId, number, remainingMs) => {identity(runId); return list(`${root}/actions/runs/${runId}/artifacts`, 'artifacts', number, remainingMs);},
    readPlanArtifact: (artifactId, remainingMs) => {identity(artifactId); return read(`${root}/actions/artifacts/${artifactId}/zip`, remainingMs, true);},
  };
}

export function createCurrentJobReader({repository, runId, attempt, ...options} = {}) {
  identity(runId); identity(attempt);
  return remainingMs => {
    const api = createGithubReader({...options, repository, budgetMs: Math.min(30_000, remainingMs)});
    return collectJobPages(page => api.listAttemptJobs(runId, attempt, page, api.remaining()));
  };
}

export function createBoundedGit({remaining, execute = execFileSync} = {}) {
  const command = (args, binary, input) => {
    const timeout = Math.floor(Math.min(5000, remaining()));
    assert.ok(Number.isFinite(timeout) && timeout > 0, 'Git evidence deadline exhausted');
    const output = execute('git', args, {encoding: binary ? null : 'utf8', timeout, killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(input === undefined ? {} : {input})});
    assert.ok(remaining() > 0, 'Git evidence deadline exhausted');
    return output;
  };
  const git = (...args) => {
    const binary = typeof args.at(-1) === 'object' && args.pop().binary;
    return command(args, binary);
  };
  git.readBlobs = ids => readGitBlobs(ids, input => command(['cat-file', '--batch'], true, input));
  return git;
}
