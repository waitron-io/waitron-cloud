import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as config from '../src/config.ts';

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
test('billing account configuration is absent by default and snapshots synthetic test ids',()=>{
 assert.equal(config.billingAccountOptionsFromEnv({},'existing'),undefined);
 assert.equal(config.billingAccountOptionsFromEnv({CLOUD_BILLING_ACCOUNT_TEST_IDS:''},'existing'),undefined);
 assert.deepEqual(config.billingAccountOptionsFromEnv({CLOUD_BILLING_ACCOUNT_TEST_IDS:first+','+second},'test-venue-levels'),{accountIds:[first,second]});
 const input={accountIds:[first]},saved=config.validateBillingAccountOptions(input,'test-venue-levels');input.accountIds[0]=second;
 assert.deepEqual(saved,{accountIds:[first]});
});
test('billing account configuration cannot enable outside test mode or accept malformed ids',()=>{
 assert.throws(()=>config.billingAccountOptionsFromEnv({CLOUD_BILLING_ACCOUNT_TEST_IDS:first},'existing'),/billing_account.test_mode_required/);
 for(const value of ['not-a-uuid',first+',',first+','+first])
  assert.throws(()=>config.billingAccountOptionsFromEnv({CLOUD_BILLING_ACCOUNT_TEST_IDS:value},'test-venue-levels'),/billing_account.invalid_config/);
});
