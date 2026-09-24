import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWaitronVerifier} from '../src/waitron-verifier.ts';
test('the real verifier refuses an unavailable checkout before claiming any job',async()=>{
 await assert.rejects(createWaitronVerifier('/missing/private-checkout'),/^Error: backup.verifier_configuration$/);
});
