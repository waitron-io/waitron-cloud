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

export type MethodPresentation={checkoutId:string}|{url:string};
export type StartedMethod={customerId:string;providerReference:string;presentation:MethodPresentation};
export function createTestBillingMethodClient(options:{stripeKey:string;sumupKey:string;portalOrigin:string;fetcher?:typeof fetch}){
 options={...options};
 let returnUrl:string;
 try{
  const origin=new URL(options.portalOrigin);
  if(origin.origin!==options.portalOrigin||!['http:','https:'].includes(origin.protocol)
   ||origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)
   ||! /^(sk|rk)_test_[A-Za-z0-9_]+$/.test(options.stripeKey)
   ||typeof options.sumupKey!=='string'||!options.sumupKey.trim()||/[^\x20-\x7e]/.test(options.sumupKey))throw new Error();
  returnUrl=origin.origin+'/account';
 }catch{throw new Error('billing_methods.invalid_config');}
 const fetcher=options.fetcher??fetch;
 async function request(provider:'stripe'|'sumup',path:string,body?:Record<string,unknown>,authorize?:()=>Promise<void>):Promise<unknown>{
  await authorize?.();
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
   const response=await fetcher((provider==='stripe'?'https://api.stripe.com/v1':'https://api.sumup.com/v0.1')+path,{
    method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+(provider==='stripe'?options.stripeKey:options.sumupKey),
     'Content-Type':provider==='stripe'?'application/x-www-form-urlencoded':'application/json'},
    body:body?(provider==='stripe'?new URLSearchParams(body as Record<string,string>).toString():JSON.stringify(body)):undefined,
   });
   if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error();}
   reader=response.body?.getReader();if(!reader)throw new Error();
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw new Error();chunks.push(value);}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  }catch{throw new Error('billing_methods.provider_unavailable');}
  finally{void reader?.cancel().catch(()=>{});}
 }
 async function preflight(setup:MethodSetup,authorize?:()=>Promise<void>){
  const expected=parseTestBillingProviderAccount(setup.providerAccountId);
  check(setup.kind===(expected.provider==='stripe'?'direct_debit':'card'));
  if(expected.provider==='stripe'){
   const account=object(await request('stripe','/account',undefined,authorize));check(account.id===expected.accountId);
   check(object(await request('stripe','/balance',undefined,authorize)).livemode===false);return account;
  }
  const account=object(await request('sumup','/me',undefined,authorize)),merchant=object(account.merchant_profile);
  check(merchant.extdev===true&&merchant.merchant_code===expected.accountId);return account;
 }
 function stripeUrl(value:unknown):string{
  check(typeof value==='string');
  let url:URL;try{url=new URL(value);}catch{check(false);}
  check(url!.origin==='https://checkout.stripe.com'&&!url!.username&&!url!.password);
  return value;
 }
 return {
  async start(setup:MethodSetup,authorize?:()=>Promise<void>):Promise<StartedMethod>{
   check(setup.customerId===null&&setup.providerReference===null);
   check(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(setup.id));
   const account=await preflight(setup,authorize);
   if(setup.kind==='direct_debit'){
    const customer=object(await request('stripe','/customers',{name:'Synthetic Cloud billing',email:'billing-test@example.invalid'},authorize));
    check(customer.livemode===false);const customerId=reference(customer.id);
    const checkout=object(await request('stripe','/checkout/sessions',{mode:'setup',currency:'eur',customer:customerId,
     'payment_method_types[]':'sepa_debit',success_url:returnUrl,cancel_url:returnUrl},authorize));
    check(checkout.livemode===false&&checkout.mode==='setup'&&checkout.status==='open'&&checkout.customer===customerId);
    return {customerId,providerReference:reference(checkout.id),presentation:{url:stripeUrl(checkout.url)}};
   }
   const customerId='cloud-test-'+setup.id;
   const customer=object(await request('sumup','/customers',{customer_id:customerId,
    personal_details:{first_name:'Synthetic',last_name:'Cloud billing',email:'billing-test@example.invalid'}},authorize));
   check(customer.customer_id===customerId);
   const checkout=object(await request('sumup','/checkouts',{checkout_reference:setup.id,amount:1,currency:'EUR',
    merchant_code:object(account.merchant_profile).merchant_code,description:'Synthetic Cloud card setup',customer_id:customerId,purpose:'SETUP_RECURRING_PAYMENT'},authorize));
   check(checkout.merchant_code===object(account.merchant_profile).merchant_code&&checkout.customer_id===customerId
    &&checkout.purpose==='SETUP_RECURRING_PAYMENT'&&checkout.status==='PENDING');
   const providerReference=reference(checkout.id);
   return {customerId,providerReference,presentation:{checkoutId:providerReference}};
  },
  async verify(setup:MethodSetup,authorize?:()=>Promise<void>):Promise<MethodVerification>{
   const customerId=reference(setup.customerId),providerReference=reference(setup.providerReference),account=await preflight(setup,authorize);
   if(setup.kind==='direct_debit'){
    const checkout=object(await request('stripe','/checkout/sessions/'+encodeURIComponent(providerReference),undefined,authorize));
    if(checkout.status!=='complete')return qualifyStripeMethod(setup,{account,checkout});
    check(checkout.livemode===false&&checkout.id===providerReference&&checkout.mode==='setup'&&checkout.customer===customerId);
    const intent=object(await request('stripe','/setup_intents/'+encodeURIComponent(reference(checkout.setup_intent)),undefined,authorize));
    if(intent.status!=='succeeded')return qualifyStripeMethod(setup,{account,checkout,intent});
    check(intent.livemode===false&&intent.id===checkout.setup_intent&&intent.customer===customerId);
    const method=await request('stripe','/payment_methods/'+encodeURIComponent(reference(intent.payment_method)),undefined,authorize);
    const mandate=await request('stripe','/mandates/'+encodeURIComponent(reference(intent.mandate)),undefined,authorize);
    return qualifyStripeMethod(setup,{account,checkout,intent,method,mandate});
   }
   const checkout=object(await request('sumup','/checkouts/'+encodeURIComponent(providerReference),undefined,authorize));
   if(checkout.status!=='PAID')return qualifySumupMethod(setup,{account,checkout});
   const instruments=await request('sumup','/customers/'+encodeURIComponent(customerId)+'/payment-instruments',undefined,authorize);
   return qualifySumupMethod(setup,{account,checkout,instruments});
  },
 };
}
