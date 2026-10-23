import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decideCountryFlow} from '../src/country-policy.ts';
import type {CountryPolicy,CountryFlow,FlowRequest} from '../src/country-policy.ts';
import {createServer} from 'node:http';
import {createOpenAiClient,ProviderError} from '../../translation/src/openai-client.ts';

const request={country:'ES',policyRevision:1,serviceId:'venue-backup-home',supplierId:'aws-infrastructure',
  accountId:'test-account',dataClass:'backup',endpoint:'https://backup.example.test/spain',region:'eu-south-2'};

test('an unknown policy refuses without returning destination or content',()=>{
  assert.deepEqual(decideCountryFlow(undefined,request),{allowed:false,reason:'unknown_policy'});
});

// Qualified fixtures exercise decisions only; they are not supplier evidence.
const home:CountryFlow={serviceId:'venue-backup-home',supplierId:'aws-infrastructure',accountId:'test-account',
  endpoint:'https://backup.example.test/spain',dataClasses:['backup'],regions:['eu-south-2'],
  evidenceId:'ev-aws-backup-home-v1',qualified:true};
const policy:CountryPolicy={country:'ES',revision:1,homeRegion:'eu-south-2',backupRegions:['eu-west-3'],flows:[home]};
const allowed={allowed:true,policyRevision:1,evidenceId:'ev-aws-backup-home-v1'};

// Missing equality guards would let one changed binding reuse the home grant.
test('the exact qualified flow returns only its revision and evidence reference',()=>{
  assert.deepEqual(decideCountryFlow(policy,request),allowed);
});
test('a different country cannot use the Spain policy',()=>{
  assert.deepEqual(decideCountryFlow(policy,{...request,country:'FR'}),{allowed:false,reason:'unknown_policy'});
});
for(const country of ['', ' ES ', 'ES\n']){
  test(`an invalid country cannot match itself: ${JSON.stringify(country)}`,()=>{
    assert.deepEqual(decideCountryFlow({...policy,country},{...request,country}),{allowed:false,reason:'unknown_policy'});
  });
}
for(const revision of [0,-1,2,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  test(`request revision ${revision} refuses`,()=>{
    assert.deepEqual(decideCountryFlow(policy,{...request,policyRevision:revision}),{allowed:false,reason:'stale_policy'});
  });
}
for(const revision of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  test(`invalid policy revision ${revision} cannot match itself`,()=>{
    assert.deepEqual(decideCountryFlow({...policy,revision},{...request,policyRevision:revision}),{allowed:false,reason:'stale_policy'});
  });
}
for(const change of [{serviceId:'venue-email'},{dataClass:'logs'}]){
  test(`an unspecified purpose or data class refuses ${JSON.stringify(change)}`,()=>{
    assert.deepEqual(decideCountryFlow(policy,{...request,...change}),{allowed:false,reason:'unqualified_flow'});
  });
}
for(const change of [{qualified:false},{evidenceId:''},{evidenceId:' evidence '},{evidenceId:'ev\nsecret'}]){
  test(`missing qualification or usable evidence refuses ${JSON.stringify(change)}`,()=>{
    assert.deepEqual(decideCountryFlow({...policy,flows:[{...home,...change}]},request),{allowed:false,reason:'unqualified_flow'});
  });
}
for(const change of [{supplierId:'another-supplier'},{accountId:'another-account'},{endpoint:'https://other.example.test/spain'},
  {endpoint:home.endpoint+'/'},{region:'eu-west-3'},{region:'eu-north-1'},{region:'eu-north-2'},{region:'eu-west-2'},{region:'eu-central-2'},
  {region:'NO'},{region:'UK'},{region:'CH'},{endpoint:home.endpoint+'?redirect=elsewhere'}]){
  test(`a different exact destination refuses ${JSON.stringify(change)}`,()=>{
    assert.deepEqual(decideCountryFlow(policy,{...request,...change}),{allowed:false,reason:'destination_denied'});
  });
}
test('home and backup labels never qualify a flow on their own',()=>{
  assert.deepEqual(decideCountryFlow({...policy,flows:[]},request),{allowed:false,reason:'unqualified_flow'});
  assert.deepEqual(decideCountryFlow({...policy,flows:[{...home,qualified:false}]},request),{allowed:false,reason:'unqualified_flow'});
});
test('destination attributes cannot be assembled from different qualified flows',()=>{
  const other={...home,accountId:'other-account',endpoint:'https://backup.example.test/other',regions:['eu-west-3']};
  assert.deepEqual(decideCountryFlow({...policy,flows:[home,other]},{...request,region:'eu-west-3'}),{allowed:false,reason:'destination_denied'});
  assert.deepEqual(decideCountryFlow({...policy,flows:[home,other]},request),allowed);
});
test('Spain logs and keys cannot inherit the separately qualified Paris backup',()=>{
  const logs={...home,serviceId:'cloud-gateway-security',dataClasses:['logs'],evidenceId:'ev-aws-gateway-metadata-v1'};
  const keys={...home,serviceId:'venue-key-custody',dataClasses:['keys'],evidenceId:'ev-aws-keys-v1'};
  const extra={...home,serviceId:'venue-backup-extra',endpoint:'https://backup.example.test/paris',regions:['eu-west-3'],evidenceId:'ev-aws-backup-paris-v1'};
  const configured={...policy,flows:[logs,keys,extra]};
  for(const [serviceId,dataClass,evidenceId] of [['cloud-gateway-security','logs','ev-aws-gateway-metadata-v1'],['venue-key-custody','keys','ev-aws-keys-v1']]){
    const input={...request,serviceId:serviceId!,dataClass:dataClass!};
    assert.deepEqual(decideCountryFlow(configured,input),{allowed:true,policyRevision:1,evidenceId});
    assert.deepEqual(decideCountryFlow(configured,{...input,region:'eu-west-3'}),{allowed:false,reason:'destination_denied'});
  }
  const copy={...request,serviceId:'venue-backup-extra',endpoint:extra.endpoint,region:'eu-west-3'};
  assert.deepEqual(decideCountryFlow(configured,copy),{allowed:true,policyRevision:1,evidenceId:'ev-aws-backup-paris-v1'});
  assert.deepEqual(decideCountryFlow({...configured,flows:[logs,keys,{...extra,qualified:false}]},copy),{allowed:false,reason:'unqualified_flow'});
});
test('separately qualified EU SES does not authorise another email purpose or backup',()=>{
  const ses:CountryFlow={serviceId:'cloud-account-email',supplierId:'amazon-ses',accountId:'test-mail-account',endpoint:'https://email.eu-west-3.amazonaws.com/',
    dataClasses:['account-email'],regions:['eu-west-3'],evidenceId:'ev-ses-account-mail-v1',qualified:true};
  const input={...request,serviceId:ses.serviceId,supplierId:ses.supplierId,accountId:ses.accountId,endpoint:ses.endpoint,dataClass:'account-email',region:'eu-west-3'};
  assert.deepEqual(decideCountryFlow({...policy,flows:[ses]},input),{allowed:true,policyRevision:1,evidenceId:'ev-ses-account-mail-v1'});
  assert.deepEqual(decideCountryFlow({...policy,flows:[ses]},{...input,serviceId:'venue-email'}),{allowed:false,reason:'unqualified_flow'});
  assert.deepEqual(decideCountryFlow({...policy,flows:[ses]},request),{allowed:false,reason:'unqualified_flow'});
});
test('another approved country uses its own home and revision',()=>{
  const french={...policy,country:'FR',revision:4,homeRegion:'eu-west-3',backupRegions:[],flows:[{...home,regions:['eu-west-3']}]};
  assert.deepEqual(decideCountryFlow(french,{...request,country:'FR',policyRevision:4,region:'eu-west-3'}),{allowed:true,policyRevision:4,evidenceId:'ev-aws-backup-home-v1'});
});
// Exact equality is insufficient when both trusted configuration and input omit a binding.
for(const field of ['serviceId','supplierId','accountId','dataClass','endpoint','region'] as const){
  for(const value of ['', ' bad ', 'bad\nvalue']){
    test(`empty or noncanonical ${field} cannot match itself: ${JSON.stringify(value)}`,()=>{
      const flow={...home,...(field==='dataClass'?{dataClasses:[value]}:field==='region'?{regions:[value]}:{[field]:value})};
      assert.deepEqual(decideCountryFlow({...policy,flows:[flow]},{...request,[field]:value}),{allowed:false,reason:'destination_denied'});
    });
  }
}
for(const endpoint of ['relative/path','http://backup.example.test/spain','https://user:pass@backup.example.test/spain',
  'https://backup.example.test/spain#fragment','https://backup.example.test/spain?query=secret',
  'https://backup.example.test/spain?','https://backup.example.test/spain#','https://BACKUP.example.test/spain','https://backup.example.test:443/spain']){
  test(`an invalid or noncanonical endpoint cannot qualify by matching itself: ${endpoint}`,()=>{
    assert.deepEqual(decideCountryFlow({...policy,flows:[{...home,endpoint}]},{...request,endpoint}),{allowed:false,reason:'destination_denied'});
  });
}
test('decisions do not change frozen inputs and return a fresh evidence record',()=>{
  const frozen=Object.freeze({...policy,flows:Object.freeze([Object.freeze({...home,dataClasses:Object.freeze(['backup']),regions:Object.freeze(['eu-south-2'])})])});
  const input:FlowRequest=Object.freeze({...request});
  const result=decideCountryFlow(frozen,input);
  assert.deepEqual(result,allowed);
  assert.notEqual(result,decideCountryFlow(frozen,input));
});

test('the public production Spain policy refuses home and Paris without qualification',async()=>{
  const api=await import('../src/index.ts');
  for(const input of [request,{...request,serviceId:'venue-backup-extra',region:'eu-west-3',endpoint:'https://backup.example.test/paris'}]){
    assert.deepEqual(api.decideCountryFlow(api.spainCountryPolicy,input),{allowed:false,reason:'unqualified_flow'});
  }
});

test('an allowed country fixture cannot enable the production AI adapter',async()=>{
  let requests=0;
  const server=createServer((_request,response)=>{requests++;response.writeHead(500).end();});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const baseUrl=`http://127.0.0.1:${address.port}/v1`;
    const flow={...home,serviceId:'venue-translation',supplierId:'openai-api',endpoint:'https://model.example.test/v1',dataClasses:['menu-text'],evidenceId:'ev-openai-translation-v1'};
    assert.deepEqual(decideCountryFlow({...policy,flows:[flow]},{...request,serviceId:flow.serviceId,supplierId:flow.supplierId,endpoint:flow.endpoint,dataClass:'menu-text'}),
      {allowed:true,policyRevision:1,evidenceId:'ev-openai-translation-v1'});
    const client=createOpenAiClient({apiKey:'unused-local-test',baseUrl});
    await assert.rejects(client.respond({instructions:'Translate menu',input:'Croquetas',effort:'low'}),
      (error:unknown)=>error instanceof ProviderError&&error.kind==='refused');
    assert.equal(requests,0);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
