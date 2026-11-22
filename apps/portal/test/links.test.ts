import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureLink } from '../src/links.ts';

test('email-change links are captured only on account and scrubbed immediately',()=>{
  const value='b'.repeat(43);let clean='';
  assert.deepEqual(captureLink(new URL(`https://cloud.example/account#change=${value}&lang=es`),v=>{clean=v;}),{invalid:false,emailChangeToken:value,locale:'es'});
  assert.equal(clean,'/account');
});
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

test('a clean pairing or sign-in page restores a valid request from history', () => {
  const url = new URL('https://cloud.example/connect');
  const id = '12345678-1234-4234-8234-123456789abc';
  const state = {pairingRequestId: id};
  assert.deepEqual(captureLink(url, () => {}, {pairingRequestId: 'bad'}), {invalid: false});
  assert.deepEqual(captureLink(url, () => {}, state), {invalid: false, requestId: id});
  assert.deepEqual(captureLink(new URL('/login', url), () => {}, state), {invalid: false, requestId: id});
  assert.deepEqual(captureLink(new URL('/account', url), () => {}, state), {invalid: false});
  assert.deepEqual(captureLink(new URL('#request=bad', url), () => {}, state), {invalid: true});
});

test('recovery fragments stay separate from venue pairing and reject query or duplicate requests',()=>{
 const id='12345678-1234-4234-8234-123456789abc';let clean='';
 assert.deepEqual(captureLink(new URL(`https://cloud.example/recover#request=${id}`),v=>{clean=v;}),{invalid:false,recoveryId:id});assert.equal(clean,'/recover');
 for(const path of [`/recover?request=${id}`,`/recover#request=${id}&request=${id}`,`/recover#request=${id}&token=${token}`]){const result=captureLink(new URL('https://cloud.example'+path),v=>{clean=v;});assert(result.invalid);assert.equal(result.recoveryId,undefined);assert(!clean.includes(id));}
});

test('captures and scrubs a linked pairing code, preserving its leading zero', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const paths: string[] = [];
  const link = captureLink(new URL(`https://cloud.example/connect#request=${id}&code=01234567&lang=es`), path => paths.push(path));
  assert.deepEqual(link, {invalid: false, requestId: id, pairingCode: '01234567', locale: 'es'});
  assert.deepEqual(paths, ['/connect']);
});

test('a malformed pairing code invalidates the entire link after scrubbing', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  const request = `request=${id}`;
  for (const path of [
    `/connect?code=01234567#${request}`, `/connect#${request}&code=01234567&code=01234567`,
    `/connect#${request}&code=1234567`, `/connect#${request}&code=01234567%0A`,
    '/connect#code=01234567', '/connect#request=bad&code=01234567',
    `/connect#${request}&${request}&code=01234567`,
    `/recover#${request}&code=01234567`, `/signup#token=${token}&code=01234567`,
  ]) {
    const clean: string[] = [];
    assert.deepEqual(captureLink(new URL('https://cloud.example' + path), value => clean.push(value)), {invalid: true}, path);
    assert.deepEqual(clean, [new URL('https://cloud.example' + path).pathname], path);
  }
});
