import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureLink } from '../src/links.ts';
const token = 'a'.repeat(43);
test('captures fragment and legacy links, clearing the URL before returning secrets', () => {
  for (const suffix of [`#token=${token}&lang=es`, `?token=${token}&lang=es`]) {
    let clean = '';
    const captured = captureLink(new URL(`https://cloud.example/signup${suffix}`), value => {clean = value;});
    assert.deepEqual(captured, {token, locale: 'es', invalid: false});
    assert.equal(clean, '/signup');
  }
});
test('rejects duplicates, conflicts, malformed and wrong-route tokens after scrubbing', () => {
  for (const path of [`/signup?token=${token}#token=${token}`, `/signup#token=${token}&token=${token}`, '/signup?token=bad', `/account#token=${token}`]) {
    let clean = '';
    const result = captureLink(new URL(`https://cloud.example${path}`), value => {clean = value;});
    assert.equal(result.invalid, true); assert.equal(result.token, undefined);
    assert.ok(!clean.includes(token)); assert.ok(!clean.includes('token='));
  }
  assert.deepEqual(captureLink(new URL('https://cloud.example/reset-password'), () => {}), {invalid: false});
});
test('captures only a single fragment request on the connection route, always scrubbing', () => {
  const id='12345678-1234-4234-8234-123456789abc';let clean='';
  assert.deepEqual(captureLink(new URL(`https://cloud.example/connect#request=${id}`),v=>{clean=v;}),{invalid:false,requestId:id});
  assert.equal(clean,'/connect');
  for(const path of [`/connect?request=${id}`,`/login#request=${id}`,`/connect#request=${id}&request=${id}`,`/connect?request=${id}#request=${id}`,'/connect#request=bad',`/connect#request=${id}&token=${token}`]) {
    const result=captureLink(new URL(`https://cloud.example${path}`),v=>{clean=v;});
    assert.equal(result.invalid,true,path);assert.equal(result.requestId,undefined,path);assert.ok(!clean.includes(id));
  }
});

test('recovery fragments stay separate from venue pairing and reject query or duplicate requests',()=>{
 const id='12345678-1234-4234-8234-123456789abc';let clean='';
 assert.deepEqual(captureLink(new URL(`https://cloud.example/recover#request=${id}`),v=>{clean=v;}),{invalid:false,recoveryId:id});assert.equal(clean,'/recover');
 for(const path of [`/recover?request=${id}`,`/recover#request=${id}&request=${id}`,`/recover#request=${id}&token=${token}`]){const result=captureLink(new URL('https://cloud.example'+path),v=>{clean=v;});assert(result.invalid);assert.equal(result.recoveryId,undefined);assert(!clean.includes(id));}
});
