import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {InstallationError,readMachineClaims,verifyMachine,verifyLease} from '@waitron-cloud/registration';
import {checkSubmitBody,jobFingerprint,maxJobBytes,TranslationError} from '../src/index.ts';

const body='{"staffName":"CARAJILLO","names":{"ca":"Cigaló"}}';
const fingerprint={jobSha256:'ec7012ab9541543706db2e63c9b6ba3b160bb3afe4ee87bf6ab2b70b9dfc460a',jobBytes:50};
const signed=(f:object)=>JSON.stringify({version:1,...f});
const invalidProof=(error:unknown)=>error instanceof InstallationError&&error.code==='invalid_proof';

test('the fingerprint counts UTF-8 bytes and hashes the exact text',()=>{
  assert.deepEqual(jobFingerprint(body),fingerprint);
  assert.notEqual(fingerprint.jobBytes,body.length);
  assert.deepEqual(checkSubmitBody(signed(fingerprint),body),fingerprint);
  assert.throws(()=>checkSubmitBody(signed(fingerprint),body.replace('Cigaló','Cigalo')),invalidProof);
  assert.throws(()=>checkSubmitBody(signed(fingerprint),body+' '),invalidProof);
  assert.throws(()=>checkSubmitBody(signed(fingerprint),body.replace('CARAJILLO','CARAXILLO')),invalidProof);
});

test('a wrong length, hash or malformed signed body is an invalid proof',()=>{
  for(const text of [
    signed({...fingerprint,jobBytes:51}),
    signed({...fingerprint,jobSha256:fingerprint.jobSha256.toUpperCase()}),
    signed({...fingerprint,jobSha256:'0'.repeat(64)}),
    signed({...fingerprint,jobSha256:'a'.repeat(63)}),
    signed({...fingerprint,jobSha256:1}),
    ...[fingerprint.jobSha256.toUpperCase(),'a'.repeat(63),1].map(jobSha256=>signed({jobSha256,jobBytes:1048577})),
    signed({...fingerprint,version:2}),
    JSON.stringify(fingerprint),
    signed({...fingerprint,extra:1}),
    'not json','null','[]','1','"text"',
    ...[0,-1,1.5,'50',null,true,Number.MAX_SAFE_INTEGER+1].map(jobBytes=>signed({...fingerprint,jobBytes})),
  ])assert.throws(()=>checkSubmitBody(text,body),invalidProof,text);
  assert.throws(()=>checkSubmitBody(signed(jobFingerprint('')),''),invalidProof);
});

test('a declared size over 1 MiB is refused before checking the body',()=>{
  assert.throws(()=>checkSubmitBody(signed({jobSha256:'0'.repeat(64),jobBytes:1048577}),'x'),
    (error:unknown)=>error instanceof TranslationError&&error.code==='job_too_large');
  const exact='a'.repeat(1048576);
  assert.equal(maxJobBytes,Buffer.byteLength(exact));
  assert.equal(checkSubmitBody(signed(jobFingerprint(exact)),exact).jobBytes,1048576);
});

test('the committed vectors are what the generator prints',()=>{
  const printed=execFileSync(process.execPath,[new URL('./make-submit-vectors.ts',import.meta.url).pathname],{encoding:'utf8'});
  assert.equal(printed,readFileSync(new URL('./submit-vectors.json',import.meta.url),'utf8'));
});

test('the contract publishes exactly the committed vectors',()=>{
  const contract=readFileSync(new URL('../../../docs/waitron-integration-contract.md',import.meta.url),'utf8');
  const section=contract.slice(contract.indexOf('### Shared test vectors'));
  const block=/```json\n([\s\S]*?)\n```/.exec(section);assert.ok(block,'vector block');
  assert.deepEqual(JSON.parse(block[1]!),JSON.parse(readFileSync(new URL('./submit-vectors.json',import.meta.url),'utf8')));
});

test('each vector has the outcome it names at the signature and fingerprint stage',()=>{
  const vectors=JSON.parse(readFileSync(new URL('./submit-vectors.json',import.meta.url),'utf8'));
  const trusted=new Map([[vectors.issuerKeyId,vectors.issuerPublicKey]]);
  assert.equal(verifyLease(vectors.lease,trusted,vectors.origin,vectors.issuedAt).installationId,vectors.installationId);
  const check=(envelope:{payload:string;signature:string;body:string})=>{
    const claims=verifyMachine({payload:envelope.payload,signature:envelope.signature},vectors.publicKey,vectors.origin,'translation-submit',vectors.issuedAt);
    assert.equal(claims.lease,JSON.stringify(vectors.lease));
    return checkSubmitBody(claims.body,envelope.body);
  };
  const byName=Object.fromEntries(vectors.cases.map((entry:{name:string})=>[entry.name,entry]));
  assert.equal(check(byName.valid.envelope).jobBytes,Buffer.byteLength(byName.valid.envelope.body));
  for(const name of ['changed_body','wrong_length'])assert.throws(()=>check(byName[name].envelope),invalidProof);
  const replay=byName.replayed_operation.envelope;
  const {body:_body,...proof}=replay;
  assert.equal(readMachineClaims(proof).operationId,vectors.operationId);
  assert.notEqual(check(replay).jobSha256,check(byName.valid.envelope).jobSha256);
});
