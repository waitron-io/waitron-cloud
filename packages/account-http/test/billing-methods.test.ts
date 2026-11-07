import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseTestBillingProviderAccount as parse} from '../src/config.ts';
import * as providers from '../src/billing-method-providers.ts';

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

function stripeSetup(){
 return {
  account:{id:'acct_synthetic'},
  checkout:{id:'cs_test_synthetic',object:'checkout.session',livemode:false,mode:'setup',status:'complete',customer:'cus_synthetic',setup_intent:'seti_synthetic'},
  intent:{id:'seti_synthetic',object:'setup_intent',livemode:false,status:'succeeded',customer:'cus_synthetic',payment_method:'pm_synthetic',mandate:'mandate_synthetic'},
  method:{id:'pm_synthetic',object:'payment_method',livemode:false,customer:'cus_synthetic',type:'sepa_debit'},
  mandate:{id:'mandate_synthetic',object:'mandate',livemode:false,status:'active',type:'multi_use',payment_method:'pm_synthetic',payment_method_details:{type:'sepa_debit'}},
 };
}
const stripeBinding={providerAccountId:'stripe-test:acct_synthetic',customerId:'cus_synthetic',providerReference:'cs_test_synthetic'};

test('Stripe completion requires the saved account checkout customer SEPA method and active mandate',()=>{
 assert.equal(typeof providers.qualifyStripeMethod,'function','missing provider verification');
 assert.deepEqual(providers.qualifyStripeMethod(stripeBinding,stripeSetup()),{state:'verified',methodId:'pm_synthetic',mandateId:'mandate_synthetic'});
});

function sumupSetup(){
 return {
  account:{merchant_profile:{merchant_code:'MSYNTHETIC',extdev:true}},
  checkout:{id:'checkout_synthetic',status:'PAID',purpose:'SETUP_RECURRING_PAYMENT',merchant_code:'MSYNTHETIC',customer_id:'customer_synthetic',payment_instrument:{token:'token_synthetic'}},
  instruments:[{token:'token_synthetic',active:true,type:'card'}],
 };
}
const sumupBinding={providerAccountId:'sumup-sandbox:MSYNTHETIC',customerId:'customer_synthetic',providerReference:'checkout_synthetic'};

test('SumUp completion requires the exact paid recurring checkout token in active customer instruments',()=>{
 assert.equal(typeof providers.qualifySumupMethod,'function','missing provider verification');
 assert.deepEqual(providers.qualifySumupMethod(sumupBinding,sumupSetup()),{state:'verified',methodId:'token_synthetic',mandateId:null});
});

for(const [part,field,value] of [
 ['account','id','acct_other'],['checkout','id','cs_test_other'],['checkout','mode','payment'],
 ['checkout','customer','cus_other'],['checkout','setup_intent','seti_other'],
 ['intent','id','seti_other'],['intent','customer','cus_other'],['intent','payment_method','pm_other'],['intent','mandate','mandate_other'],
 ['method','id','pm_other'],['method','customer','cus_other'],['method','type','card'],
 ['mandate','id','mandate_other'],['mandate','payment_method','pm_other'],
 ...['checkout','intent','method','mandate'].flatMap(part=>[[part,'livemode',true] as const,[part,'livemode',undefined] as const]),
] as const)test(`Stripe refuses a different or unqualified ${part}.${field}: ${String(value)}`,()=>{
 const data=stripeSetup();(data[part as keyof typeof data] as Record<string,unknown>)[field]=value;
 assert.throws(()=>providers.qualifyStripeMethod(stripeBinding,data),/billing_methods.provider_mismatch/);
});

for(const [part,field,value]of[
 ['account','extdev',false],['account','merchant_code','MOTHER'],['checkout','id','checkout_other'],
 ['checkout','merchant_code','MOTHER'],['checkout','customer_id','customer_other'],['checkout','purpose','CHECKOUT'],
 ['instrument','token','token_other'],['instrument','type','bank_account'],
]as const)test(`SumUp refuses a different or unqualified ${part}.${field}`,()=>{
 const data=sumupSetup(),target=part==='account'?data.account.merchant_profile:part==='instrument'?data.instruments[0]!:data.checkout;
 (target as Record<string,unknown>)[field]=value;
 assert.throws(()=>providers.qualifySumupMethod(sumupBinding,data),/billing_methods.provider_mismatch/);
});

test('unfinished setups stay pending and expired or failed setups never verify',()=>{
 const stripe=stripeSetup();stripe.checkout.status='open';stripe.intent.status='requires_action';
 assert.deepEqual(providers.qualifyStripeMethod(stripeBinding,stripe),{state:'pending'});
 stripe.checkout.status='expired';assert.deepEqual(providers.qualifyStripeMethod(stripeBinding,stripe),{state:'failed'});
 stripe.checkout.status='complete';stripe.intent.status='canceled';assert.deepEqual(providers.qualifyStripeMethod(stripeBinding,stripe),{state:'failed'});
 const sumup=sumupSetup();sumup.checkout.status='PENDING';assert.deepEqual(providers.qualifySumupMethod(sumupBinding,sumup),{state:'pending'});
 for(const status of ['FAILED','EXPIRED']){sumup.checkout.status=status;assert.deepEqual(providers.qualifySumupMethod(sumupBinding,sumup),{state:'failed'});}
});

test('an inactive SEPA mandate or saved card cannot become a selected method',()=>{
 const stripe=stripeSetup();stripe.mandate.status='inactive';
 assert.deepEqual(providers.qualifyStripeMethod(stripeBinding,stripe),{state:'failed'});
 const sumup=sumupSetup();sumup.instruments[0]!.active=false;
 assert.deepEqual(providers.qualifySumupMethod(sumupBinding,sumup),{state:'failed'});
});

test('an open Stripe checkout cannot verify even when its SetupIntent already succeeded',()=>{
 const data=stripeSetup();data.checkout.status='open';
 assert.deepEqual(providers.qualifyStripeMethod(stripeBinding,data),{state:'pending'});
});

test('a pending Stripe mandate cannot verify even after checkout and intent complete',()=>{
 const data=stripeSetup();data.mandate.status='pending';
 assert.deepEqual(providers.qualifyStripeMethod(stripeBinding,data),{state:'pending'});
});

test('provider tokens remain opaque within the existing billing reference boundary',()=>{
 const data=sumupSetup(),token='opaque+/= token';
 data.checkout.payment_instrument.token=token;data.instruments[0]!.token=token;
 assert.deepEqual(providers.qualifySumupMethod(sumupBinding,data),{state:'verified',methodId:token,mandateId:null});
 for(const invalid of ['', 'a'.repeat(257), 'token\n', '☃']){
  data.checkout.payment_instrument.token=invalid;data.instruments[0]!.token=invalid;
  assert.throws(()=>providers.qualifySumupMethod(sumupBinding,data),/billing_methods.provider_mismatch/);
 }
});
