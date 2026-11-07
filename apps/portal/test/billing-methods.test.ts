import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validBillingView} from '../src/billing-types.ts';

function view(paymentMethods:unknown){return {venues:[{venueId:'11111111-1111-4111-8111-111111111111',level:'registered',trial:null,canStartTrial:true,paymentMethods}]};}
test('the trial reader accepts the optional method state without breaking the existing chooser',()=>{
 for(const methods of [{selected:null,setup:null},{selected:'card',setup:{kind:'direct_debit',state:'pending'}},
  {selected:'direct_debit',setup:{kind:'card',state:'failed'}},{selected:'card',setup:{kind:'card',state:'verified'}}])
  assert.equal(validBillingView(view(methods)),true);
});
test('the method reader refuses unknown kinds states and private provider fields',()=>{
 for(const methods of [null,{}, {selected:'cash',setup:null},{selected:null,setup:{kind:'cash',state:'pending'}},
  {selected:null,setup:{kind:'card',state:'done'}},{selected:null,setup:{kind:'card',state:'pending',checkoutId:'private'}},
  {selected:'card',setup:null,customerId:'private'}, {selected:null,setup:undefined}])assert.equal(validBillingView(view(methods)),false);
});

test('method state accepts strings only and cannot coerce arrays into an allowed kind',()=>{
 for(const methods of [{selected:['card'],setup:null},{selected:null,setup:{kind:['card'],state:'pending'}},
  {selected:null,setup:{kind:'card',state:['pending']}}])assert.equal(validBillingView(view(methods)),false);
});
