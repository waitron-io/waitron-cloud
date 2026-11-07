import {parseTestBillingProviderAccount} from './config.ts';
import type {MethodSetup} from './billing-method-binding.ts';

type Binding=Pick<MethodSetup,'providerAccountId'|'customerId'|'providerReference'>;
export type MethodVerification={state:'pending'|'failed'}|{state:'verified';methodId:string;mandateId:string|null};
function check(value:unknown):asserts value{
 if(!value)throw new Error('billing_methods.provider_mismatch');
}
function object(value:unknown):Record<string,unknown>{
 check(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;
}
function reference(value:unknown):string{
 check(typeof value==='string'&&value.length>0&&value.length<=256&&!/[^\x20-\x7e]/.test(value));return value;
}

export function qualifyStripeMethod(binding:Binding,value:unknown):MethodVerification{
 const expected=parseTestBillingProviderAccount(binding.providerAccountId);
 check(expected.provider==='stripe');reference(binding.customerId);reference(binding.providerReference);
 const data=object(value),account=object(data.account),checkout=object(data.checkout);
 check(account.id===expected.accountId);
 for(const name of ['checkout','intent','method','mandate'])
  if(data[name]!=null)check(object(data[name]).livemode===false);
 check(checkout.id===binding.providerReference&&checkout.mode==='setup'&&checkout.customer===binding.customerId);
 if(checkout.status==='expired')return {state:'failed'};
 check(['open','complete'].includes(String(checkout.status)));
 if(checkout.status!=='complete')return {state:'pending'};
 const intent=object(data.intent);
 check(reference(checkout.setup_intent)===intent.id&&intent.customer===binding.customerId);
 if(intent.status==='canceled'||intent.status==='requires_payment_method'&&intent.last_setup_error)return {state:'failed'};
 check(['requires_payment_method','requires_confirmation','requires_action','processing','succeeded'].includes(String(intent.status)));
 if(intent.status!=='succeeded')return {state:'pending'};
 const method=object(data.method),mandate=object(data.mandate);
 check(reference(intent.payment_method)===method.id&&method.customer===binding.customerId&&method.type==='sepa_debit');
 check(reference(intent.mandate)===mandate.id&&mandate.payment_method===method.id);
 if(mandate.status==='inactive')return {state:'failed'};
 if(mandate.status==='pending')return {state:'pending'};
 check(mandate.status==='active');
 return {state:'verified',methodId:reference(method.id),mandateId:reference(mandate.id)};
}

export function qualifySumupMethod(binding:Binding,value:unknown):MethodVerification{
 const expected=parseTestBillingProviderAccount(binding.providerAccountId);
 check(expected.provider==='sumup');reference(binding.customerId);reference(binding.providerReference);
 const data=object(value),account=object(object(data.account).merchant_profile),checkout=object(data.checkout);
 check(account.extdev===true&&account.merchant_code===expected.accountId);
 check(checkout.id===binding.providerReference&&checkout.merchant_code===expected.accountId
  &&checkout.customer_id===binding.customerId&&checkout.purpose==='SETUP_RECURRING_PAYMENT');
 if(['FAILED','EXPIRED'].includes(String(checkout.status)))return {state:'failed'};
 if(checkout.status==='PENDING')return {state:'pending'};
 check(checkout.status==='PAID');
 const token=reference(object(checkout.payment_instrument).token);check(Array.isArray(data.instruments));
 const matching=data.instruments.map(object).filter(instrument=>instrument.token===token);
 check(matching.length===1&&matching[0]!.type==='card');
 if(matching[0]!.active===false)return {state:'failed'};
 check(matching[0]!.active===true);
 return {state:'verified',methodId:token,mandateId:null};
}
