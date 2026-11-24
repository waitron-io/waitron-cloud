import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountHttpConfig} from '../src/config.ts';

const environment = {
  CLOUD_PORTAL_ORIGIN: 'https://cloud.example.test',
  CLOUD_HTTP_RATE_KEY: 'ab'.repeat(32),
};

test('sign-up limits have production defaults and accept explicit fixture overrides', () => {
  const defaults = {
    requestsPerHour: 5, accountsPerConnectionPerDay: 5, accountsPerDomainPerDay: 5,
    emailsPerAddressPerDay: 3, resendSeconds: 300, operatorWarningThreshold: 10,
  };
  assert.deepEqual(accountHttpConfig(environment).signupLimits, defaults);
  assert.deepEqual(accountHttpConfig({
    ...environment, CLOUD_SIGNUP_LIMITS: '{"requestsPerHour":20,"accountsPerDomainPerDay":8}',
  }).signupLimits, {...defaults, requestsPerHour: 20, accountsPerDomainPerDay: 8});
});

test('invalid limits fail startup instead of silently weakening sign-up admission', () => {
  for (const setting of ['null','[]','{','{"requestsPerHour":0}','{"requestsPerHour":"5"}',
    '{"resendSeconds":86401}','{"accountsPerDay":40}']) {
    assert.throws(() => accountHttpConfig({...environment,CLOUD_SIGNUP_LIMITS: setting}), /Invalid sign-up limits/);
  }
});
