import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountHttpConfig} from '../src/config.ts';

const environment = {CLOUD_PORTAL_ORIGIN: 'https://cloud.example.test', CLOUD_HTTP_RATE_KEY: 'ab'.repeat(32)};

test('Turnstile is off with neither key and refuses to start with just one', () => {
  assert.equal(accountHttpConfig(environment).turnstile, undefined);
  assert.throws(() => accountHttpConfig({...environment, CLOUD_TURNSTILE_SITE_KEY: 'test-site'}), /Invalid account HTTP configuration/);
  assert.throws(() => accountHttpConfig({...environment, CLOUD_TURNSTILE_SECRET_KEY: 'test-secret'}), /Invalid account HTTP configuration/);
  assert.deepEqual(accountHttpConfig({...environment, CLOUD_TURNSTILE_SITE_KEY: 'test-site', CLOUD_TURNSTILE_SECRET_KEY: 'test-secret'}).turnstile,
    {siteKey: 'test-site', secretKey: 'test-secret'});
});
