import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test,type TestContext} from 'node:test';
import * as clients from '../src/billing-method-providers.ts';

const intent={id:'11111111-1111-4111-8111-111111111111',ownerId:'22222222-2222-4222-8222-222222222222',
 organisationId:'33333333-3333-4333-8333-333333333333',legalBusinessId:'44444444-4444-4444-8444-444444444444',
 methodId:'55555555-5555-4555-8555-555555555555',createdAt:'2026-11-07T00:00:00.000Z',customerId:null,providerReference:null};
const stripe={...intent,kind:'direct_debit' as const,providerAccountId:'stripe-test:acct_synthetic'};
const sumup={...intent,kind:'card' as const,providerAccountId:'sumup-sandbox:MSYNTHETIC'};

async function fixture(t:TestContext,change?:(path:string,value:Record<string,any>)=>unknown){
 const requests:{method:string;path:string;body:Record<string,unknown>;authorization:string}[]=[];
 const replies:Record<string,unknown>={
  '/v1/account':{id:'acct_synthetic'},'/v1/balance':{livemode:false},
  '/v1/customers':{id:'cus_synthetic',livemode:false},
  '/v1/checkout/sessions':{id:'cs_test_synthetic',livemode:false,mode:'setup',status:'open',customer:'cus_synthetic',url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'},
  '/v1/checkout/sessions/cs_test_synthetic':{id:'cs_test_synthetic',livemode:false,mode:'setup',status:'complete',customer:'cus_synthetic',setup_intent:'seti_synthetic'},
  '/v1/setup_intents/seti_synthetic':{id:'seti_synthetic',livemode:false,status:'succeeded',customer:'cus_synthetic',payment_method:'pm_synthetic',mandate:'mandate_synthetic'},
  '/v1/payment_methods/pm_synthetic':{id:'pm_synthetic',livemode:false,type:'sepa_debit',customer:'cus_synthetic'},
  '/v1/mandates/mandate_synthetic':{id:'mandate_synthetic',livemode:false,status:'active',payment_method:'pm_synthetic'},
  '/v0.1/me':{merchant_profile:{merchant_code:'MSYNTHETIC',extdev:true}},
  '/v0.1/customers':{customer_id:'cloud-test-'+intent.id},
  '/v0.1/checkouts':{id:'checkout_synthetic',status:'PENDING',merchant_code:'MSYNTHETIC',customer_id:'cloud-test-'+intent.id,purpose:'SETUP_RECURRING_PAYMENT'},
  '/v0.1/checkouts/checkout_synthetic':{id:'checkout_synthetic',status:'PAID',merchant_code:'MSYNTHETIC',customer_id:'cloud-test-'+intent.id,purpose:'SETUP_RECURRING_PAYMENT',payment_instrument:{token:'token_synthetic'}},
  ['/v0.1/customers/cloud-test-'+intent.id+'/payment-instruments']:[{type:'card',active:true,token:'token_synthetic'}],
 };
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString(),path=req.url!;
  const body=raw?(req.headers['content-type']==='application/json'?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw))):{};
  requests.push({method:req.method!,path,body,authorization:req.headers.authorization??''});
  const value=change?change(path,structuredClone(replies[path]) as Record<string,any>):replies[path];
  res.setHeader('content-type','application/json');
  if(value===undefined){res.statusCode=500;res.end('{"error":"synthetic provider secret"}');}
  else res.end(JSON.stringify(value));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
 const port=(server.address() as {port:number}).port;
 const fetcher:typeof fetch=(url,init)=>{
  const target=new URL(String(url));
  assert.ok(['api.stripe.com','api.sumup.com'].includes(target.hostname));
  assert.equal(target.protocol,'https:');assert.equal(init?.redirect,'error');assert.ok(init?.signal);
  return fetch('http://127.0.0.1:'+port+target.pathname+target.search,init);
 };
 function make(overrides:Record<string,unknown>={}){
  assert.equal(typeof clients.createTestBillingMethodClient,'function','missing outbound test method client');
  return clients.createTestBillingMethodClient({stripeKey:'sk_test_synthetic',sumupKey:'synthetic-sandbox-key',portalOrigin:'http://localhost:3000',fetcher,...overrides});
 }
 return {requests,make,fetcher};
}

test('Stripe setup creates a fresh synthetic customer and a SEPA-only hosted session returning to account',async t=>{
 const f=await fixture(t),client=f.make();
 assert.deepEqual(await client.start(stripe),{customerId:'cus_synthetic',providerReference:'cs_test_synthetic',presentation:{url:'https://checkout.stripe.com/c/pay/cs_test_synthetic'}});
 assert.deepEqual(f.requests.map(r=>r.method+' '+r.path),['GET /v1/account','GET /v1/balance','POST /v1/customers','POST /v1/checkout/sessions']);
 assert.deepEqual(f.requests[2]!.body,{name:'Synthetic Cloud billing',email:'billing-test@example.invalid'});
 assert.deepEqual(f.requests[3]!.body,{mode:'setup',currency:'eur',customer:'cus_synthetic','payment_method_types[]':'sepa_debit',success_url:'http://localhost:3000/account',cancel_url:'http://localhost:3000/account'});
 assert.ok(f.requests.every(r=>r.authorization==='Bearer sk_test_synthetic'));
});

test('SumUp setup creates a fresh synthetic customer and EUR1 recurring sandbox checkout',async t=>{
 const f=await fixture(t),client=f.make();
 assert.deepEqual(await client.start(sumup),{customerId:'cloud-test-'+intent.id,providerReference:'checkout_synthetic',presentation:{checkoutId:'checkout_synthetic'}});
 assert.deepEqual(f.requests.map(r=>r.method+' '+r.path),['GET /v0.1/me','POST /v0.1/customers','POST /v0.1/checkouts']);
 assert.deepEqual(f.requests[1]!.body,{customer_id:'cloud-test-'+intent.id,personal_details:{first_name:'Synthetic',last_name:'Cloud billing',email:'billing-test@example.invalid'}});
 assert.deepEqual(f.requests[2]!.body,{checkout_reference:intent.id,amount:1,currency:'EUR',merchant_code:'MSYNTHETIC',description:'Synthetic Cloud card setup',customer_id:'cloud-test-'+intent.id,purpose:'SETUP_RECURRING_PAYMENT'});
 assert.ok(f.requests.every(r=>r.authorization==='Bearer synthetic-sandbox-key'));
});

test('verification reads only the saved provider references and qualifies both methods',async t=>{
 const f=await fixture(t),client=f.make();
 assert.deepEqual(await client.verify({...stripe,customerId:'cus_synthetic',providerReference:'cs_test_synthetic'}),{state:'verified',methodId:'pm_synthetic',mandateId:'mandate_synthetic'});
 assert.deepEqual(await client.verify({...sumup,customerId:'cloud-test-'+intent.id,providerReference:'checkout_synthetic'}),{state:'verified',methodId:'token_synthetic',mandateId:null});
 assert.ok(f.requests.every(r=>r.method==='GET'));
 assert.deepEqual(f.requests.map(r=>r.path),['/v1/account','/v1/balance','/v1/checkout/sessions/cs_test_synthetic','/v1/setup_intents/seti_synthetic','/v1/payment_methods/pm_synthetic','/v1/mandates/mandate_synthetic','/v0.1/me','/v0.1/checkouts/checkout_synthetic','/v0.1/customers/cloud-test-'+intent.id+'/payment-instruments']);
});

for(const [path,patch,setup] of [
 ['/v1/account',{id:'acct_other'},stripe],['/v1/balance',{livemode:true},stripe],
 ['/v0.1/me',{merchant_profile:{merchant_code:'MOTHER',extdev:true}},sumup],
 ['/v0.1/me',{merchant_profile:{merchant_code:'MSYNTHETIC',extdev:false}},sumup],
] as const)test('provider preflight refuses writes for '+JSON.stringify(patch),async t=>{
 const f=await fixture(t,(p,v)=>p===path?patch:v);
 await assert.rejects(()=>f.make().start(setup),/billing_methods.provider_mismatch/);
 assert.ok(f.requests.every(r=>r.method==='GET'));
});

for(const url of ['http://checkout.stripe.com/c/test','https://checkout.stripe.com.evil.invalid/test','https://evil.invalid/','https://x@checkout.stripe.com/test','https://checkout.stripe.com:444/test'])
 test('Stripe refuses an unsafe presentation URL '+url,async t=>{
  const f=await fixture(t,(p,v)=>p==='/v1/checkout/sessions'?{...v,url}:v);
  await assert.rejects(()=>f.make().start(stripe),/billing_methods.provider_mismatch/);
 });

test('a live Stripe key is refused before dispatch',async t=>{
 const f=await fixture(t);
 assert.throws(()=>f.make({stripeKey:'sk_live_synthetic'}),/billing_methods.invalid_config/);
 assert.equal(f.requests.length,0);
});

test('uncertain provider writes are not retried and response errors expose no provider content',async t=>{
 const f=await fixture(t,(p,v)=>p==='/v1/customers'?undefined:v);
 await assert.rejects(()=>f.make().start(stripe),error=>error instanceof Error&&error.message==='billing_methods.provider_unavailable');
 assert.equal(f.requests.filter(r=>r.method==='POST').length,1);
});

test('provider credentials are snapshotted before an external configuration object changes',async t=>{
 const f=await fixture(t),config={stripeKey:'sk_test_synthetic',sumupKey:'synthetic-sandbox-key',portalOrigin:'http://localhost:3000',fetcher:f.fetcher};
 const client=clients.createTestBillingMethodClient(config);config.stripeKey='sk_live_replaced';config.sumupKey='replaced';
 await client.start(stripe);await client.start(sumup);
 assert.ok(f.requests.filter(r=>r.path.startsWith('/v1/')).every(r=>r.authorization==='Bearer sk_test_synthetic'));
 assert.ok(f.requests.filter(r=>r.path.startsWith('/v0.1/')).every(r=>r.authorization==='Bearer synthetic-sandbox-key'));
});

for(const [path,patch,setup] of [
 ['/v1/customers',{livemode:true},stripe],['/v1/customers',{id:''},stripe],
 ['/v1/checkout/sessions',{livemode:true},stripe],['/v1/checkout/sessions',{mode:'payment'},stripe],
 ['/v1/checkout/sessions',{customer:'cus_other'},stripe],['/v1/checkout/sessions',{id:'bad\n'},stripe],
 ['/v0.1/customers',{customer_id:'another-customer'},sumup],['/v0.1/checkouts',{merchant_code:'MOTHER'},sumup],
 ['/v0.1/checkouts',{customer_id:'another-customer'},sumup],['/v0.1/checkouts',{purpose:'CHECKOUT'},sumup],
] as const)test('setup response correlation refuses '+path+' '+JSON.stringify(patch),async t=>{
 const f=await fixture(t,(p,v)=>p===path?{...v,...patch}:v);
 await assert.rejects(()=>f.make().start(setup),/billing_methods.provider_mismatch/);
});

test('bound or wrong-kind setup is refused before any provider request',async t=>{
 const f=await fixture(t),client=f.make();
 for(const setup of [{...stripe,customerId:'cus_saved'},{...sumup,providerReference:'checkout_saved'},{...stripe,kind:'card' as const}])
  await assert.rejects(()=>client.start(setup),/billing_methods.provider_mismatch/);
 assert.equal(f.requests.length,0);
});

for(const [path,status,expected] of [
 ['/v1/checkout/sessions/cs_test_synthetic','open','pending'],['/v1/checkout/sessions/cs_test_synthetic','expired','failed'],
 ['/v1/setup_intents/seti_synthetic','requires_action','pending'],['/v1/setup_intents/seti_synthetic','canceled','failed'],
] as const)test('Stripe '+status+' returns '+expected+' without reading an absent next object',async t=>{
 const f=await fixture(t,(p,v)=>p===path?{...v,status,...(path.includes('/checkout/')?{setup_intent:null}:{payment_method:null,mandate:null})}:v);
 assert.deepEqual(await f.make().verify({...stripe,customerId:'cus_synthetic',providerReference:'cs_test_synthetic'}),{state:expected});
 assert.equal(f.requests.at(-1)!.path,path);
});

for(const status of ['PENDING','FAILED','EXPIRED'])test('SumUp '+status+' needs no saved instrument read',async t=>{
 const f=await fixture(t,(p,v)=>p==='/v0.1/checkouts/checkout_synthetic'?{...v,status,payment_instrument:null}:v);
 assert.deepEqual(await f.make().verify({...sumup,customerId:'cloud-test-'+intent.id,providerReference:'checkout_synthetic'}),{state:status==='PENDING'?'pending':'failed'});
 assert.equal(f.requests.at(-1)!.path,'/v0.1/checkouts/checkout_synthetic');
});

test('provider response size is bounded without exposing its content',async t=>{
 const f=await fixture(t,(p,v)=>p==='/v1/account'?{...v,secret:'x'.repeat(65536)}:v);
 await assert.rejects(()=>f.make().start(stripe),error=>error instanceof Error&&error.message==='billing_methods.provider_unavailable');
 assert.equal(f.requests.length,1);
});

test('each provider request checks current authority before dispatching the next write',async t=>{
 const f=await fixture(t);let authorizations=0;
 await assert.rejects(()=>f.make().start(stripe,async()=>{if(++authorizations===4)throw new Error('permission_denied');}),/permission_denied/);
 assert.deepEqual(f.requests.map(r=>r.method+' '+r.path),['GET /v1/account','GET /v1/balance','POST /v1/customers']);
});
