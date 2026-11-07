import assert from 'node:assert/strict';
import {test} from 'node:test';

const load = () => import('./test-fixtures/integration-verification-evidence.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-verification-evidence.mjs')) return {};
  throw error;
});
const expected = {pointId: 'point-a', venueId: 'venue-a', installationId: 'installation-a', sourceNodeId: 'node-a', sha256: 'a'.repeat(64), bytes: 123};
const targetDigest = 'b'.repeat(64), image = 'sha256:' + 'c'.repeat(64);
const point = {id: 'point-a', venue_id: 'venue-a', installation_id: 'installation-a', source_node_id: 'node-a', digest: expected.sha256, size: '123', verification: 'verified', current_evidence_id: 'attempt-a'};
const attempt = {id: 'attempt-a', point_id: 'point-a', state: 'finished', status: 'passed', reason: 'none', current_verification: 'verified', cleanup_confirmed: true,
  child_id: 'd'.repeat(64), controller_scope: 'controller-a', request_digest: 'e'.repeat(64), target_digest: targetDigest, verifier_image: 'local.waitron-verifier@' + image,
  request: {pointId: 'point-a', venueId: 'venue-a', sourceInstallationId: 'installation-a', sourceNodeId: 'node-a', archive: {sha256: expected.sha256, bytes: 123}, target: {digest: targetDigest}},
  result: {status: 'passed', reason: 'none', activation: 'not_attempted', targetDigest, requestDigest: 'e'.repeat(64), measuredArchive: {sha256: expected.sha256, bytes: 123},
    modules: ['adjustments','bookings','catalogue','core','credentials','fiscal-none','fiscal-verifactu','identity','media','payments','scheduler','staffing','venue-service','workforce','workforce-es'].map(name => ({name, status: 'passed', checks: [{code: 'data', status: 'passed'}]}))}};

// A pending point, a foreign attempt or metadata-only success must never become a verification receipt.
test('verification evidence binds the independently read admission to the same paired capture', async () => {
  const {inspectIntegrationVerification: inspect} = await load();
  assert.equal(typeof inspect, 'function', 'Independent delivered-worker evidence checking is missing');
  const result = inspect(point, attempt, expected, targetDigest, image);
  assert.deepEqual(result, {pointId: 'point-a', sha256: expected.sha256, bytes: 123, attemptId: 'attempt-a', childId: 'd'.repeat(64), controllerScope: 'controller-a', targetDigest, status: 'passed', activation: 'not_attempted', modules: 15, cleanupConfirmed: true});
});

const currentOwners = ['bookings','core','fiscal-none','fiscal-verifactu','node','payments','workforce','workforce-es'];
const currentAttempt = () => ({...structuredClone(attempt), result: {...structuredClone(attempt.result),
  modules: currentOwners.map(name => ({name, status: 'passed', checks: [{code: 'data', status: 'passed'}]}))}});
test('explicit current-image evidence requires the complete validated target owner list', async () => {
  const {inspectIntegrationVerification: inspect} = await load();
  assert.equal(inspect(point, currentAttempt(), expected, targetDigest, image, currentOwners).modules, 8);
  assert.throws(() => inspect(point, currentAttempt(), expected, targetDigest, image));
});
for (const [name, change] of [
  ['missing node owner', a => {a.result.modules.splice(4, 1);}],
  ['duplicate owner', a => {a.result.modules[4] = structuredClone(a.result.modules[0]);}],
  ['additional duplicate owner', a => {a.result.modules.push(structuredClone(a.result.modules[0]));}],
  ['unexpected owner', a => {a.result.modules.push({name: 'unexpected', status: 'passed', checks: [{code: 'data', status: 'passed'}]});}],
  ['failed node owner', a => {a.result.modules[4].status = 'failed';}],
  ['unchecked node owner', a => {a.result.modules[4].checks = [];}],
  ['failed node check', a => {a.result.modules[4].checks[0].status = 'failed';}],
]) test('current-image evidence refuses ' + name, async () => {
  const {inspectIntegrationVerification: inspect} = await load();
  const a = currentAttempt(); change(a);
  assert.throws(() => inspect(point, a, expected, targetDigest, image, currentOwners));
});
for (const [name, change] of [
  ['point', (p) => {p.id = 'point-b';}], ['venue', (p) => {p.venue_id = 'venue-b';}],
  ['installation', (p) => {p.installation_id = 'installation-b';}], ['source', (p) => {p.source_node_id = 'node-b';}],
  ['digest', (p) => {p.digest = 'f'.repeat(64);}], ['length', (p) => {p.size = '124';}],
  ['pending', (p) => {p.verification = 'pending';}], ['selected attempt', (p) => {p.current_evidence_id = 'attempt-b';}],
  ['attempt point', (_, a) => {a.point_id = 'point-b';}], ['unfinished', (_, a) => {a.state = 'running';}],
  ['failed', (_, a) => {a.status = 'invalid';}], ['attempt reason', (_, a) => {a.reason = 'module_integrity';}], ['unqualified', (_, a) => {a.current_verification = 'pending';}],
  ['cleanup', (_, a) => {a.cleanup_confirmed = false;}], ['child', (_, a) => {a.child_id = null;}],
  ['target', (_, a) => {a.target_digest = 'f'.repeat(64);}], ['image', (_, a) => {a.verifier_image = 'foreign@' + image;}],
  ['request point', (_, a) => {a.request.pointId = 'point-b';}], ['request installation', (_, a) => {a.request.sourceInstallationId = 'installation-b';}],
  ['request venue', (_, a) => {a.request.venueId = 'venue-b';}], ['request source', (_, a) => {a.request.sourceNodeId = 'node-b';}],
  ['request archive', (_, a) => {a.request.archive.bytes = 124;}], ['request target', (_, a) => {a.request.target.digest = 'f'.repeat(64);}],
  ['result reason', (_, a) => {a.result.reason = 'module_integrity';}], ['activation', (_, a) => {a.result.activation = 'attempted';}], ['measured digest', (_, a) => {a.result.measuredArchive.sha256 = 'f'.repeat(64);}],
  ['measured length', (_, a) => {a.result.measuredArchive.bytes = 124;}], ['result request', (_, a) => {a.result.requestDigest = 'f'.repeat(64);}],
  ['result target', (_, a) => {a.result.targetDigest = 'f'.repeat(64);}], ['result status', (_, a) => {a.result.status = 'invalid';}],
  ['missing module', (_, a) => {a.result.modules.pop();}], ['duplicate module', (_, a) => {a.result.modules[0] = a.result.modules[1];}],
  ['failed module', (_, a) => {a.result.modules[0].status = 'failed';}], ['unchecked module', (_, a) => {a.result.modules[0].checks = [];}], ['failed check', (_, a) => {a.result.modules[0].checks[0].status = 'failed';}],
]) test('verification evidence refuses ' + name, async () => {
  const {inspectIntegrationVerification: inspect} = await load();
  assert.equal(typeof inspect, 'function', 'Independent delivered-worker evidence checking is missing');
  const p = structuredClone(point), a = structuredClone(attempt); change(p, a);
  assert.throws(() => inspect(p, a, expected, targetDigest, image));
});
