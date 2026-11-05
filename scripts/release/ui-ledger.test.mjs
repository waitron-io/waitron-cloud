import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {reserveRelease, appendReleaseEvent, validateLedger} from './ui-ledger.mjs';

const source = {repository: 'clintongormley/waitron', commit: 'a'.repeat(40), version: '0.1.0'};
const request = {
  source, inputsSha512: 'b'.repeat(128), recipeSha512: 'c'.repeat(128),
  sourceChecksSha512: 'd'.repeat(128), registryVersions: ['0.1.0'],
  at: '2026-11-05T20:00:00.000Z',
};

// Without allocation from the ledger, repeated source builds can consume different versions.
test('reserves 0.2.0 independently of the source version without changing its input', () => {
  const ledger = {schema: 1, events: []};
  assert.deepEqual(reserveRelease(ledger, request), {
    schema: 1,
    events: [{type: 'reserved', source, version: '0.2.0',
      inputsSha512: 'b'.repeat(128), recipeSha512: 'c'.repeat(128),
      sourceChecksSha512: 'd'.repeat(128), at: '2026-11-05T20:00:00.000Z'}],
  });
  assert.deepEqual(ledger, {schema: 1, events: []});
});

const reserved = () => reserveRelease({schema: 1, events: []}, request);
const artifact = {sha512: 'e'.repeat(128), manifestSha512: 'f'.repeat(128),
  notices: {LICENSE: '1'.repeat(128), 'LICENSE-GRANTS.md': '2'.repeat(128)}};
const event = (type, fields = {}) => ({type, sourceCommit: source.commit, version: '0.2.0',
  at: '2026-11-05T20:01:00.000Z', ...fields});
const prepared = () => appendReleaseEvent(reserved(), event('prepared', {artifact}));
const uploading = () => appendReleaseEvent(prepared(), event('uploading'));
const published = () => appendReleaseEvent(uploading(), event('published', {
  readback: {...artifact, source, visibility: 'private', publishedAt: '2026-11-05T20:01:00.000Z'},
}));

test('a retry reuses its reservation and refuses changed source or preparation identity', () => {
  const ledger = reserved();
  assert.deepEqual(reserveRelease(ledger, {...request, at: '2026-11-05T20:02:00.000Z'}), ledger);
  for (const fields of [{source: {...source, version: '0.1.1'}}, {inputsSha512: '3'.repeat(128)},
    {recipeSha512: '3'.repeat(128)}, {sourceChecksSha512: '3'.repeat(128)}]) {
    assert.throws(() => reserveRelease(ledger, {...request, ...fields}), /identity/);
  }
});

test('an unfinished reservation blocks a later source even when its number is absent from the registry', () => {
  for (const ledger of [reserved(), prepared(), uploading()]) {
    assert.throws(() => reserveRelease(ledger, {...request, source: {...source, commit: '4'.repeat(40)},
      at: '2026-11-05T20:02:00.000Z'}), /unfinished/);
  }
});

test('published and withdrawn numbers remain consumed and the next source receives 0.2.1', () => {
  for (const registryVersions of [['0.1.0', '0.2.0'], ['0.1.0']]) {
    const ledger = reserveRelease(published(), {...request, source: {...source, commit: '4'.repeat(40)},
      registryVersions, at: '2026-11-05T20:02:00.000Z'});
    assert.equal(ledger.events.at(-1).version, '0.2.1');
    assert.deepEqual(ledger.events.slice(0, -1), published().events);
  }
});

test('an unowned registry release stops allocation instead of skipping to another number', () => {
  for (const registryVersions of [['0.1.0', '0.2.0'], ['0.1.0', '0.2.4'], ['0.3.0']]) {
    assert.throws(() => reserveRelease({schema: 1, events: []}, {...request, registryVersions}), /unowned/);
  }
});

test('only matching private registry readback can finalise an upload', () => {
  assert.equal(published().events.at(-1).type, 'published');
  const good = {...artifact, source, visibility: 'private', publishedAt: '2026-11-05T20:01:00.000Z'};
  for (const fields of [{sha512: '3'.repeat(128)}, {manifestSha512: '3'.repeat(128)},
    {notices: {...artifact.notices, LICENSE: '3'.repeat(128)}},
    {source: {...source, commit: '4'.repeat(40)}}, {visibility: 'public'}, {publishedAt: 'not-a-date'},
    {publishedAt: '2026-11-05T20:02:00.000Z'}]) {
    assert.throws(() => appendReleaseEvent(uploading(), event('published', {readback: {...good, ...fields}})), /readback|time/);
  }
});

test('a prepared artifact is immutable and an uploading state cannot blindly upload again', () => {
  assert.deepEqual(appendReleaseEvent(prepared(), event('prepared', {artifact})), prepared());
  assert.throws(() => appendReleaseEvent(prepared(), event('prepared', {artifact: {...artifact, sha512: '3'.repeat(128)}})), /immutable/);
  assert.throws(() => appendReleaseEvent(uploading(), event('uploading', {at: '2026-11-05T20:02:00.000Z'})), /uncertain/);
  assert.throws(() => appendReleaseEvent(reserved(), event('published', {readback: {}})), /transition/);
  assert.throws(() => appendReleaseEvent(published(), event('prepared', {artifact})), /transition/);
});

test('event identity, field allowlists and source evidence are validated before persistence', () => {
  for (const fields of [{source: {...source, repository: 'other/repo'}}, {source: {...source, commit: 'main'}},
    {source: {...source, version: 'bad'}}, {inputsSha512: 'short'}, {recipeSha512: 'short'},
    {sourceChecksSha512: 'short'}, {at: 'bad'}, {token: 'never-store-this'}]) {
    assert.throws(() => reserveRelease({schema: 1, events: []}, {...request, ...fields}));
  }
  for (const fields of [{sourceCommit: '4'.repeat(40)}, {version: '0.2.1'}, {token: 'never-store-this'},
    {at: '2026-11-05T19:00:00.000Z'}, {artifact: {...artifact, token: 'never-store-this'}}]) {
    assert.throws(() => appendReleaseEvent(reserved(), event('prepared', {artifact, ...fields})));
  }
});

test('a loaded ledger must replay every valid transition and refuse edits or extra fields', () => {
  assert.deepEqual(validateLedger(published()), published());
  for (const bad of [{schema: 2, events: []}, {...published(), token: 'never-store-this'},
    {...published(), events: published().events.slice(1)},
    {...published(), events: [...published().events, published().events[0]]}]) {
    assert.throws(() => validateLedger(bad));
  }
});

test('a registry version appearing before our upload stops both reservation and preparation retries', () => {
  for (const ledger of [reserved(), prepared()]) {
    assert.throws(() => reserveRelease(ledger, {...request, registryVersions: ['0.1.0', '0.2.0'],
      at: '2026-11-05T20:02:00.000Z'}), /unowned/);
  }
  assert.deepEqual(reserveRelease(uploading(), {...request, registryVersions: ['0.1.0', '0.2.0']}), uploading());
});

test('replay handles two thousand retained releases within its ten-second command budget', () => {
  const script = `import assert from 'node:assert/strict';
    import {validateLedger} from ${JSON.stringify(new URL('./ui-ledger.mjs', import.meta.url).href)};
    const events = [];
    for (let i=0;i<2000;i++) {
      const source={repository:'clintongormley/waitron',commit:i.toString(16).padStart(40,'0'),version:'0.1.0'};
      const version='0.2.'+i, at='2026-11-05T20:00:00.000Z';
      const artifact={sha512:'e'.repeat(128),manifestSha512:'f'.repeat(128),notices:{LICENSE:'1'.repeat(128),'LICENSE-GRANTS.md':'2'.repeat(128)}};
      events.push({type:'reserved',source,version,at,inputsSha512:'b'.repeat(128),recipeSha512:'c'.repeat(128),sourceChecksSha512:'d'.repeat(128)},
        {type:'prepared',sourceCommit:source.commit,version,at,artifact},
        {type:'uploading',sourceCommit:source.commit,version,at},
        {type:'published',sourceCommit:source.commit,version,at,readback:{...artifact,source,visibility:'private',publishedAt:at}});
    }
    const result=validateLedger({schema:1,events});
    assert.equal(result.events.length,8000);assert.equal(result.events.at(-1).version,'0.2.1999');
    console.log('8000 retained events validated');`;
  assert.match(execFileSync(process.execPath, ['--input-type=module', '-e', script],
    {encoding: 'utf8', timeout: 10000}), /8000 retained events validated/);
});

test('loaded history refuses duplicate sources, wrong allocations and duplicate transitions', () => {
  assert.throws(() => validateLedger({schema: 1, events: [{...reserved().events[0], version: '0.2.9'}]}), /next reservation/);
  assert.throws(() => validateLedger({schema: 1, events: [...published().events,
    {...reserved().events[0], version: '0.2.1', at: '2026-11-05T20:02:00.000Z'}]}), /duplicate source/);
  assert.throws(() => validateLedger({schema: 1, events: [...prepared().events, prepared().events.at(-1)]}), /duplicate ledger transition/);
  assert.throws(() => reserveRelease(reserved(), {...request, registryVersions: ['0.1.0', '0.1.0']}), /duplicate registry/);
});

test('every upload and publication field stays within the ledger allowlist', () => {
  assert.throws(() => appendReleaseEvent(prepared(), event('uploading', {token: 'never-store-this'})), /unexpected fields/);
  assert.throws(() => appendReleaseEvent(uploading(), event('published', {token: 'never-store-this',
    readback: {...artifact, source, visibility: 'private', publishedAt: '2026-11-05T20:01:00.000Z'}})), /unexpected fields/);
});

test('timestamp ordering uses actual instants across extended ISO years', () => {
  const extended = '+010000-01-01T00:00:00.000Z';
  assert.equal(appendReleaseEvent(reserved(), event('prepared', {artifact, at: extended})).events.at(-1).at, extended);
  assert.throws(() => appendReleaseEvent(uploading(), event('published', {
    readback: {...artifact, source, visibility: 'private', publishedAt: extended},
  })), /future/);
});
