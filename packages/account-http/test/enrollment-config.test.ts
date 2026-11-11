import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountHttpConfig, validateConfig} from '../src/config.ts';

const env = {CLOUD_PORTAL_ORIGIN: 'https://cloud.example.test', CLOUD_HTTP_RATE_KEY: 'ab'.repeat(32)};
test('country enrollment is off by default and explicitly enabled by its service setting', () => {
  assert.notEqual(accountHttpConfig(env).requireEnrollment, true);
  assert.notEqual(accountHttpConfig({...env, CLOUD_REQUIRE_ENROLLMENT: 'false'}).requireEnrollment, true);
  assert.equal(accountHttpConfig({...env, CLOUD_REQUIRE_ENROLLMENT: 'true'}).requireEnrollment, true);
});
test('invalid country enrollment settings refuse startup rather than silently disabling policy', () => {
  for (const value of ['', 'TRUE', '1']) assert.throws(() => accountHttpConfig({...env, CLOUD_REQUIRE_ENROLLMENT: value}));
  assert.throws(() => validateConfig({...accountHttpConfig(env), requireEnrollment: 'true' as unknown as boolean}));
});
