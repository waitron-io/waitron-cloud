import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as methods from '../src/billing-methods.ts';

const billing={accountIds:['11111111-1111-4111-8111-111111111111']};
const env={CLOUD_BILLING_METHODS_MODE:'test',CLOUD_BILLING_STRIPE_TEST_ACCOUNT:'acct_synthetic',CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT:'MSYNTHETIC',
 CLOUD_BILLING_STRIPE_TEST_KEY:'sk_test_synthetic',CLOUD_BILLING_SUMUP_SANDBOX_KEY:'synthetic-sandbox-key'};
function read(value:NodeJS.ProcessEnv=env,mode:'existing'|'test-venue-levels'='test-venue-levels',accounts:typeof billing|undefined=billing){
 assert.equal(typeof methods.billingMethodsOptionsFromEnv,'function','missing opt-in method runtime');
 return methods.billingMethodsOptionsFromEnv(value,mode,accounts,'http://localhost:3000');
}
test('payment runtime is absent by default and ignores keys while explicitly off',()=>{
 assert.equal(read({}),undefined);assert.equal(read({...env,CLOUD_BILLING_METHODS_MODE:'off'}),undefined);
});
test('payment runtime requires explicit test mode the existing account allowlist and test provider credentials',()=>{
 const value=read()!;
 assert.equal(value.stripeAccount,'stripe-test:acct_synthetic');assert.equal(value.sumupAccount,'sumup-sandbox:MSYNTHETIC');
 assert.equal(typeof value.client.start,'function');assert.equal(typeof value.client.verify,'function');
 assert.throws(()=>read(env,'existing'),/billing_methods.test_mode_required/);
 assert.throws(()=>methods.billingMethodsOptionsFromEnv(env,'test-venue-levels',undefined,'http://localhost:3000'),/billing_methods.test_mode_required/);
 for(const patch of [{CLOUD_BILLING_METHODS_MODE:'live'},{CLOUD_BILLING_STRIPE_TEST_KEY:'sk_live_synthetic'},
  {CLOUD_BILLING_STRIPE_TEST_ACCOUNT:''},{CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT:'MOTHER:extra'},
  {CLOUD_BILLING_SUMUP_SANDBOX_KEY:''}])assert.throws(()=>read({...env,...patch}),/billing_methods.invalid_config/);
});
test('direct method options preserve the test-only boundary and snapshot provider configuration',()=>{
 const client={start:async()=>{throw new Error('not called');},verify:async()=>{throw new Error('not called');}};
 const value={stripeAccount:'stripe-test:acct_synthetic',sumupAccount:'sumup-sandbox:MSYNTHETIC',client};
 assert.throws(()=>methods.validateBillingMethodsOptions(value,'existing',billing),/billing_methods.test_mode_required/);
 assert.throws(()=>methods.validateBillingMethodsOptions(value,'test-venue-levels',undefined),/billing_methods.test_mode_required/);
 const saved=methods.validateBillingMethodsOptions(value,'test-venue-levels',billing)!;
 value.stripeAccount='stripe-live:acct_other';client.start=async()=>{throw new Error('replaced');};
 assert.equal(saved.stripeAccount,'stripe-test:acct_synthetic');assert.notEqual(saved.client.start,client.start);
});
