import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

function keys(value,names,label){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`${label} must be an object`);
 assert.deepEqual(Object.keys(value).sort(),[...names].sort(),`${label} must have exactly the required fields`);
}
function sha(value,label){assert.equal(typeof value,'string',`${label} must be a SHA`);assert.match(value,/^[a-f0-9]{40}$/,`${label} must be a full SHA`);}
const facts=['backendDeltasMatch','operationalDaysZero','userDaysThree','restartReplayStable','crashGapIncomplete','foreignScopeRefused'];
const counts=['tests','passed','failed','cancelled','skipped','todo'];

/** The wrapper supplies its own clean candidate identity; a receipt cannot establish that identity itself. */
export function verifyAllowanceTrafficReceipt(receipt,candidate){
 keys(candidate,['cloudHead','cloudTree'],'candidate');
 for(const field of ['cloudHead','cloudTree'])sha(candidate[field],`candidate.${field}`);
 keys(receipt,['version','kind','cloudHead','cloudTree','scope','productionEnforcement','checks','suites','cleanup','limitations'],'receipt');
 assert.equal(receipt.version,1);assert.equal(receipt.kind,'cloud-allowance-traffic');
 assert.equal(receipt.scope,'local-fixtures');assert.equal(receipt.productionEnforcement,'off');
 for(const field of ['cloudHead','cloudTree']){sha(receipt[field],field);assert.equal(receipt[field],candidate[field],`${field} must match the independent candidate`);}
 keys(receipt.checks,facts,'checks');for(const field of facts)assert.equal(receipt.checks[field],true,`${field} must be proved`);
 assert.ok(Array.isArray(receipt.suites),'suites must be an array');
 for(const suite of receipt.suites){
  keys(suite,['id',...counts],'suite');
  for(const field of counts)assert.ok(Number.isSafeInteger(suite[field])&&suite[field]>=0,`${suite.id}.${field} must be a nonnegative safe integer`);
  assert.ok(suite.tests>0,`${suite.id} must run tests`);assert.equal(suite.passed,suite.tests,`${suite.id} must pass every test`);
  for(const field of ['failed','cancelled','skipped','todo'])assert.equal(suite[field],0,`${suite.id}.${field} must be zero`);
 }
 assert.deepEqual(receipt.suites.map(s=>s.id).sort(),['collector','counters','gateway'],'each required suite must appear exactly once');
 keys(receipt.cleanup,['containers','volumes','processes'],'cleanup');
 for(const field of ['containers','volumes','processes'])assert.equal(receipt.cleanup[field],0,`cleanup.${field} must be zero`);
 assert.ok(Array.isArray(receipt.limitations)&&receipt.limitations.length>0,'limitations must be explicit');
 for(const limitation of receipt.limitations)assert.ok(typeof limitation==='string'&&limitation.trim().length>0,'each limitation must be nonempty text');
 return receipt;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.argv.length,5,'Usage: node scripts/verify-allowance-traffic-receipt.mjs <receipt.json> <cloud-head> <cloud-tree>');
 const receipt=verifyAllowanceTrafficReceipt(JSON.parse(await readFile(process.argv[2],'utf8')),{cloudHead:process.argv[3],cloudTree:process.argv[4]});
 console.log(`verified allowance traffic at ${receipt.cloudHead} tree ${receipt.cloudTree}`);
}
