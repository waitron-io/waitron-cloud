import assert from 'node:assert/strict';

const sha = /^[a-f0-9]{128}$/;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const copy = value => structuredClone(value);
function keys(value, expected) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'expected an object');
  assert.deepEqual(Object.keys(value).sort(), expected.split(' ').sort(), 'unexpected fields');
}
function time(value) {
  assert.equal(typeof value, 'string', 'invalid time');
  assert(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'invalid time');
}
function sourceIdentity(source) {
  keys(source, 'repository commit version');
  assert.equal(source.repository, 'clintongormley/waitron', 'unexpected source repository');
  assert.match(source.commit, /^[a-f0-9]{40}$/, 'source commit must be pinned');
  assert.match(source.version, version, 'invalid source version');
}
function artifactIdentity(artifact) {
  keys(artifact, 'sha512 manifestSha512 notices');
  assert.match(artifact.sha512, sha, 'invalid artifact hash');
  assert.match(artifact.manifestSha512, sha, 'invalid manifest hash');
  keys(artifact.notices, 'LICENSE LICENSE-GRANTS.md');
  for (const value of Object.values(artifact.notices)) assert.match(value, sha, 'invalid notice hash');
}
const reservations = ledger => ledger.events.filter(event => event.type === 'reserved');
function nextVersion(ledger) {
  const previous = reservations(ledger).at(-1);
  if (!previous) return '0.2.0';
  const patch = BigInt(previous.version.split('.')[2]) + 1n;
  return `0.2.${patch}`;
}

function append(ledger, event, clone = true) {
  time(event.at);
  const last = ledger.events.at(-1);
  if (last) assert(Date.parse(event.at) >= Date.parse(last.at), 'event time moved backwards');
  if (event.type === 'reserved') {
    keys(event, 'type source version inputsSha512 recipeSha512 sourceChecksSha512 at');
    sourceIdentity(event.source);
    for (const field of ['inputsSha512', 'recipeSha512', 'sourceChecksSha512']) assert.match(event[field], sha, `invalid ${field}`);
    assert(!reservations(ledger).some(previous => previous.source.commit === event.source.commit), 'duplicate source reservation');
    assert(!last || last.type === 'published', 'unfinished release blocks later sources');
    assert.equal(event.version, nextVersion(ledger), 'release version is not the next reservation');
  } else {
    const reservation = reservations(ledger).at(-1);
    assert(reservation, 'transition requires a reservation');
    assert.equal(event.sourceCommit, reservation.source.commit, 'event source identity differs');
    assert.equal(event.version, reservation.version, 'event release identity differs');
    if (event.type === 'prepared') {
      keys(event, 'type sourceCommit version artifact at');
      artifactIdentity(event.artifact);
      if (last.type === 'prepared') {
        assert.deepEqual(event.artifact, last.artifact, 'prepared bytes are immutable');
        return copy(ledger);
      }
      assert.equal(last.type, 'reserved', 'invalid prepared transition');
    } else if (event.type === 'uploading') {
      keys(event, 'type sourceCommit version at');
      assert.equal(last.type, 'prepared', last.type === 'uploading'
        ? 'uncertain upload requires readback, never a blind retry' : 'invalid uploading transition');
    } else if (event.type === 'published') {
      keys(event, 'type sourceCommit version readback at');
      assert.equal(last.type, 'uploading', 'invalid published transition');
      keys(event.readback, 'sha512 manifestSha512 notices source visibility publishedAt');
      const {source, visibility, publishedAt, ...artifact} = event.readback;
      const prepared = ledger.events.at(-2);
      assert.deepEqual(artifact, prepared.artifact, 'registry readback differs from prepared bytes');
      assert.deepEqual(source, reservation.source, 'registry readback source differs');
      assert.equal(visibility, 'private', 'registry readback visibility differs');
      time(publishedAt);
      assert(Date.parse(publishedAt) <= Date.parse(event.at), 'registry readback publication time is in the future');
    } else assert.fail('unknown release transition');
  }
  const events = clone ? copy(ledger.events) : ledger.events;
  events.push(clone ? copy(event) : event);
  return {schema: 1, events};
}

export function validateLedger(ledger) {
  keys(ledger, 'schema events');
  assert.equal(ledger.schema, 1, 'unknown ledger schema');
  assert(Array.isArray(ledger.events), 'ledger events must be an array');
  let validated = {schema: 1, events: []};
  for (const event of ledger.events) {
    const length = validated.events.length;
    const next = append(validated, event, false);
    assert.equal(next.events.length, length + 1, 'duplicate ledger transition');
    validated = next;
  }
  return copy(validated);
}

export function reserveRelease(ledger, request) {
  ledger = validateLedger(ledger);
  keys(request, 'source inputsSha512 recipeSha512 sourceChecksSha512 registryVersions at');
  const {registryVersions, ...identity} = request;
  sourceIdentity(identity.source);
  time(identity.at);
  assert(Array.isArray(registryVersions), 'registry versions must be a complete array');
  assert.equal(new Set(registryVersions).size, registryVersions.length, 'duplicate registry versions');
  const owned = new Set(ledger.events.filter(event => event.type === 'uploading').map(event => event.version));
  for (const number of registryVersions) {
    assert.match(number, version, 'invalid registry version');
    // This series begins at 0.2.0; only the existing 0.1.0 predates its ledger.
    assert(number === '0.1.0' || owned.has(number), 'unowned registry version blocks allocation');
  }
  const existing = reservations(ledger).find(event => event.source.commit === identity.source.commit);
  if (existing) {
    const {type, version: releaseVersion, at, ...previous} = existing;
    const {at: requestedAt, ...wanted} = identity;
    assert.deepEqual(wanted, previous, 'reserved source or preparation identity differs');
    return copy(ledger);
  }
  return append(ledger, {type: 'reserved', ...identity, version: nextVersion(ledger)});
}

export function appendReleaseEvent(ledger, event) {
  return append(validateLedger(ledger), event);
}
