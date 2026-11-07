import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseTestBillingProviderAccount as parse} from '../src/config.ts';

// The prefix is the persisted test-mode boundary for future payment callers.
for(const [reference,expected] of [
 ['stripe-test:acct_synthetic',{provider:'stripe',accountId:'acct_synthetic'}],
 ['sumup-sandbox:MSYNTHETIC',{provider:'sumup',accountId:'MSYNTHETIC'}],
] as const)test(`saved method resolves its test provider account: ${reference}`,()=>{
 assert.deepEqual(parse(reference),expected);
});

for(const reference of [undefined,null,1,{},'acct_synthetic','stripe:acct_synthetic','sumup:MSYNTHETIC',
 'stripe-live:acct_synthetic','sumup-live:MSYNTHETIC','stripe-test:','sumup-sandbox:',
 'stripe-test:acct_synthetic:extra','sumup-sandbox:MSYNTHETIC:extra','stripe-test:acct synthetic',
 'sumup-sandbox:MSYNTHETIC\n','stripe-test:'+ 'a'.repeat(245)])
 test(`saved method refuses an unqualified provider account: ${JSON.stringify(reference)}`,()=>{
  assert.throws(()=>parse(reference),/billing_methods.invalid_provider_account/);
 });

test('saved test provider reference respects the billing store length boundary',()=>{
 assert.deepEqual(parse('stripe-test:'+'a'.repeat(244)),{provider:'stripe',accountId:'a'.repeat(244)});
});
