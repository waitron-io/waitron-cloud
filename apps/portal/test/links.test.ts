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
