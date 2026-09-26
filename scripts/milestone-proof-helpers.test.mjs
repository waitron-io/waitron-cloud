import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {expectedOldAuthorityRefusal,repositoryRoot} from './milestone-proof-helpers.mjs';

test('repository root decodes spaces in a module URL',()=>{
 const moduleUrl=new URL('scripts/cloud-two-venue-milestone-receipt.mjs',pathToFileURL('/tmp/cloud proof/'));
 assert.equal(repositoryRoot(moduleUrl),'/tmp/cloud proof');
});

test('old authority evidence accepts only Waitron binding refusal',()=>{
 assert.equal(expectedOldAuthorityRefusal(new Error('Waitron capture client failed: AppError: cloud.binding_conflict')),true);
 for(const error of [
  new Error('Waitron capture client failed: AppError: cloud.unavailable'),
  new Error('Waitron capture client timed out'),
  new Error('Unexpected end of JSON input'),
  'cloud.binding_conflict',
 ])assert.equal(expectedOldAuthorityRefusal(error),false);
});
