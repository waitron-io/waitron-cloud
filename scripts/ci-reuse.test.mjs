import assert from 'node:assert/strict';
import test from 'node:test';
import {findReuse} from './ci-reuse.mjs';

const context = {repository: 'waitron-io/waitron-cloud', repositoryId: 123, runId: 90, attempt: 1, workflowId: 17,
  eventName: 'push', ref: 'refs/heads/main', sha: 'a'.repeat(40),
  event: {before: 'b'.repeat(40), after: 'a'.repeat(40)}};

test('scheduled, called, manual and malformed invocations have no reuse authority or API side effects', () => {
  let reads = 0;
  const api = {readRepository: () => {reads++; throw Error('Unexpected lookup');}};
  const git = () => {reads++; throw Error('Unexpected Git read');};
  for (const value of [
    {...context, full: true}, {...context, called: true},
    ...['schedule', 'workflow_dispatch', 'workflow_call', 'pull_request'].map(eventName => ({...context, eventName})),
    {...context, ref: 'refs/heads/feature'}, {...context, repository: 'attacker/fork'},
    ...['repositoryId', 'runId', 'attempt', 'workflowId'].map(key => ({...context, [key]: 0})),
    ...['forced', 'deleted', 'created'].map(key => ({...context, event: {...context.event, [key]: true}})),
    {...context, event: {...context.event, after: 'c'.repeat(40)}}, {...context, event: {...context.event, before: '0'.repeat(40)}},
  ]) {
    const result = findReuse(value, {api, git}, '.github/workflows/ci.yml');
    assert.equal(result.reuse, null);
    assert.ok(result.reason.length > 0);
  }
  assert.equal(reads, 0, 'Ineligible invocations must not consult historical evidence');
});
