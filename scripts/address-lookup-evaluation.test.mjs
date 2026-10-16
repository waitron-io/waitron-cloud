import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const module = await import('./address-lookup-evaluation.mjs').catch(() => ({}));

test('request budget persists reservations before dispatch and stops before 1500 across restarts', async () => {
  assert.equal(typeof module.RequestBudget, 'function', 'persistent request budget is missing');
  const directory = mkdtempSync(join(tmpdir(), 'address-budget-'));
  try {
    const budget = new module.RequestBudget(directory);
    assert.throws(() => new module.RequestBudget(directory), /locked/);
    budget.reserve('google', 'autocomplete', 'case-1');
    assert.equal(JSON.parse(readFileSync(join(directory, 'requests.jsonl'), 'utf8')).provider, 'google');
    budget.close();
    const events = Array.from({length: 1499}, (_, i) => JSON.stringify({provider:'google',operation:'autocomplete',caseId:'fixture',ordinal:i+1,at:'2026-10-16T00:00:00.000Z'})).join('\n')+'\n';
    writeFileSync(join(directory, 'requests.jsonl'), events);
    const resumed = new module.RequestBudget(directory);
    assert.throws(() => resumed.reserve('google', 'validation', 'over-limit'), /budget/);
    assert.equal(resumed.counts.google, 1499);
    resumed.reserve('geoapify', 'autocomplete', 'independent');
    assert.equal(resumed.counts.geoapify, 1);
    resumed.close();
    writeFileSync(join(directory, 'requests.jsonl'), events+'{"provider":');
    assert.throws(() => new module.RequestBudget(directory), /journal/);
  } finally { rmSync(directory, {recursive:true, force:true}); }
});

const expected = {street:['Plaza de Cibeles'],number:'1',postcode:'28014',locality:['Madrid'],province:['Madrid'],unit:null};
const good = {country:'es',street:'PLAZA CIBELES',number:'1',postcode:'28014',locality:'Madrid',province:'Madrid',unit:null};

test('scoring rejects a wrong street, country and administrative region without borrowing expected components', () => {
  assert.equal(typeof module.score, 'function', 'independent scoring is missing');
  assert.deepEqual(module.score(expected, good), {selectable:true,wrongMatch:false,houseNumber:true,postcode:true,locality:true,province:true,country:true,unit:null,noResult:false});
  for (const field of ['country','street','locality']) assert.equal(module.score(expected, {...good,[field]:'wrong'}).selectable, false);
  for (const field of ['number','postcode','province']) assert.equal(module.score(expected, {...good,[field]:''})[field==='number'?'houseNumber':field], false);
  assert.equal(module.score(expected, null).noResult,true);
  assert.equal(module.score({...expected,unit:'2 B'}, {...good,unit:null}).unit,false);
});

test('adapters map structured components, keep missing fields empty and do not treat a country filter as a returned country', () => {
  assert.equal(typeof module.normalize, 'function', 'provider adapters are missing');
  assert.deepEqual(module.normalize('geoapify',{country_code:'es',street:'Plaza Cibeles',housenumber:'1',postcode:'28014',city:'Madrid',county:'Madrid'}), {...good,street:'Plaza Cibeles'});
  const g = {address:{postalAddress:{regionCode:'ES',postalCode:'28014',locality:'Madrid'},addressComponents:[{componentType:'route',componentName:{text:'Plaza Cibeles'}},{componentType:'street_number',componentName:{text:'1'}},{componentType:'administrative_area_level_2',componentName:{text:'Madrid'}}]}};
  assert.deepEqual(module.normalize('google',g), {...good,street:'Plaza Cibeles'});
  assert.equal(module.normalize('google',{address:{postalAddress:{regionCode:'ES'}}}).postcode,'');
  assert.equal(module.normalize('geoapify',{state:'Andalucía'}).province,'');
  assert.equal(module.normalize('cartociudad',{countryCode:'es',tip_via:'Plaza',address:'CIBELES',portalNumber:1,postalCode:'28014',muni:'Madrid',province:'Madrid'}).country,'es');
  assert.equal(module.normalize('cartociudad',{tip_via:'Plaza',address:'CIBELES',portalNumber:1,postalCode:'28014',muni:'Madrid',province:'Madrid'}).country,'');
});

test('request runner reserves failures, refuses redirects, redacts credentials and never retries a refused key', async () => {
  assert.equal(typeof module.EvaluationClient,'function','bounded provider client is missing');
  const directory = mkdtempSync(join(tmpdir(), 'address-client-'));
  const budget = new module.RequestBudget(directory);
  const seen=[];
  try {
    const client = new module.EvaluationClient({budget,directory,keys:{google:'secret-google',geoapify:'secret-geo'},spacingMs:0,fetcher:async(url,options) => {
      seen.push({url,options});
      assert.equal(JSON.parse(readFileSync(join(directory,'requests.jsonl'),'utf8').trim().split('\n').at(-1)).ordinal,seen.length);
      return new Response(JSON.stringify({error:{message:'secret-google https://example.test/a?key=secret-geo'}}),{status:403});
    }});
    await assert.rejects(client.request('google','autocomplete','id','Madrid'),/refused/);
    assert.equal(budget.counts.google,1);
    assert.equal(seen.length,1);
    assert.equal(seen[0].options.redirect,'error');
    assert.equal(seen[0].options.headers['X-Goog-Api-Key'],'secret-google');
    assert.equal(seen[0].url.search,'');
    const raw=readFileSync(join(directory,'raw','google-1.json'),'utf8');
    assert.ok(!raw.includes('secret-google') && !raw.includes('secret-geo') && !raw.includes('?key='));
    await assert.rejects(client.request('unknown','autocomplete','id','Madrid'),/provider/);
    assert.equal(seen.length,1);
  } finally {budget.close();rmSync(directory,{recursive:true,force:true});}
});

test('wire requests constrain Spain, Geoapify EU and each service to its authorised API', () => {
  assert.equal(typeof module.requestFor,'function','authorised request builders are missing');
  const keys={google:'g',geoapify:'x'};
  const geo=module.requestFor('geoapify','autocomplete','Cibeles',keys);
  assert.equal(geo.url.origin,'https://api-eu.geoapify.com');
  assert.equal(geo.url.searchParams.get('filter'),'countrycode:es');
  assert.equal(module.requestFor('geoapify','geocode','Cibeles',keys).url.pathname,'/v1/geocode/search');
  const google=module.requestFor('google','autocomplete','Cibeles',keys);
  assert.deepEqual(JSON.parse(google.options.body).includedRegionCodes,['es']);
  const validation=module.requestFor('google','validation','Cibeles',keys);
  assert.deepEqual(JSON.parse(validation.options.body).address,{regionCode:'ES',addressLines:['Cibeles']});
  assert.equal(module.requestFor('cartociudad','candidates','Cibeles',keys).url.searchParams.get('countrycodes'),'es');
  assert.throws(()=>module.requestFor('google','details','Cibeles',keys),/operation/);
  assert.throws(()=>module.requestFor('geoapify','autocomplete','Cibeles',{}),/key/);
});

test('evaluation follows the first Google prediction and keeps failures out of no-result counts', async () => {
  assert.equal(typeof module.evaluateCase,'function','case evaluation is missing');
  const calls=[];
  const client={request:async(provider,operation,id,query)=>{calls.push({operation,query});return operation==='autocomplete'?{suggestions:[{placePrediction:{text:{text:'Wrong road 9, Paris'}}},{placePrediction:{text:{text:'Plaza Cibeles 1, Madrid'}}}]}:{address:{postalAddress:{regionCode:'FR',locality:'Paris',postalCode:'75001'},addressComponents:[{componentType:'route',componentName:{text:'Wrong road'}}]}};}};
  const result=await module.evaluateCase(client,'google',{id:'case',query:'Plaza Cibeles 1, Madrid',inScope:true,expected});
  assert.equal(calls[1].query,'Wrong road 9, Paris');
  assert.equal(result.stages.selection.selectable,false);
  assert.equal(result.stages.selection.country,false);
  const failed=await module.evaluateCase({request:async()=>{throw new Error('timeout');}},'geoapify',{id:'case',query:'Madrid',inScope:true,expected});
  assert.equal(failed.error,'timeout');
  assert.deepEqual(failed.stages,{});
  const empty=await module.evaluateCase({request:async()=>({suggestions:[]})},'google',{id:'case',query:'Madrid',inScope:true,expected});
  assert.equal(empty.stages.selection.noResult,true);
});

test('Geoapify measures both endpoints on original input and CartoCiudad uses find only for non-point first results', async () => {
  assert.equal(typeof module.evaluateCase,'function','case evaluation is missing');
  const row={id:'case',query:'Madrid original',inScope:true,expected};
  const calls=[];
  const client={request:async(provider,operation,id,query)=>{calls.push({operation,query});if(provider==='geoapify')return {results:[{country_code:'es',street:'Plaza Cibeles',housenumber:'1',postcode:'28014',city:'Madrid',county:'Madrid'}]};return operation==='candidates'?[{id:'street123',type:'callejero',address:'CIBELES',tip_via:'PLAZA',muni:'Madrid'}]:{countryCode:'011',tip_via:'Plaza',address:'CIBELES',portalNumber:1,postalCode:'28014',muni:'Madrid',province:'Madrid',lat:40.419,lng:-3.693};}};
  const geo=await module.evaluateCase(client,'geoapify',row);
  assert.equal(geo.stages.autocomplete.selectable,true);
  assert.equal(geo.stages.geocode.postcode,true);
  assert.deepEqual(calls,[{operation:'autocomplete',query:'Madrid original'},{operation:'geocode',query:'Madrid original'}]);
  calls.length=0;
  const carto=await module.evaluateCase(client,'cartociudad',row);
  assert.equal(carto.stages.selection.province,true);
  assert.deepEqual(calls[1],{operation:'find',query:{id:'street123',type:'callejero'}});
  const pointCalls=[];
  await module.evaluateCase({request:async(p,op)=>{pointCalls.push(op);return [{countryCode:'011',address:'CIBELES',tip_via:'PLAZA',lat:40.4,lng:-3.7}];}},'cartociudad',row);
  assert.deepEqual(pointCalls,['candidates']);
  const find=module.requestFor('cartociudad','find',{id:'street123',type:'callejero'},{});
  assert.equal(find.url.searchParams.get('id'),'street123');
  assert.equal(find.url.searchParams.has('q'),false);
});

test('a timed out dispatch is counted once and its receipt contains no transport exception text', async () => {
  assert.equal(typeof module.EvaluationClient,'function');
  const directory=mkdtempSync(join(tmpdir(),'address-timeout-'));
  const budget=new module.RequestBudget(directory);
  let calls=0;
  try {
    const client=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:0,fetcher:async()=>{calls++;throw new DOMException('secret key in https://private.test/?key=secret','TimeoutError');}});
    await assert.rejects(client.request('google','autocomplete','timeout','Madrid'),/timeout/);
    assert.equal(calls,1);
    assert.equal(budget.counts.google,1);
    assert.equal(client.measurements[0].timeout,true);
    assert.ok(!readFileSync(join(directory,'measurements.jsonl'),'utf8').includes('secret'));
  } finally {budget.close();rmSync(directory,{recursive:true,force:true});}
});

test('a resumed corpus skips completed cases and stops immediately on a refused key', async () => {
  assert.equal(typeof module.runCases,'function','resumable corpus runner is missing');
  const directory=mkdtempSync(join(tmpdir(),'address-cases-'));
  const rows=[{id:'first',query:'Madrid',inScope:true,expected},{id:'second',query:'Madrid',inScope:false,expected}];
  let requests=0;
  try {
    const client={request:async()=>{requests++;throw new Error('Provider key refused');}};
    const first=await module.runCases(client,'google',rows,directory,'a'.repeat(64));
    assert.equal(first.length,1);
    assert.equal(requests,1);
    await assert.rejects(module.runCases(client,'google',rows,directory,'b'.repeat(64)),/corpus/);
    const second=await module.runCases(client,'google',rows,directory,'a'.repeat(64));
    assert.equal(second.length,1);
    assert.equal(requests,1,'refused key must stay blocked on resume');
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('malformed successful responses are errors rather than flattering empty matches', async () => {
  assert.equal(typeof module.evaluateCase,'function');
  for(const provider of ['geoapify','cartociudad']) {
    const r=await module.evaluateCase({request:async()=>({unexpected:true})},provider,{id:'case',query:'Madrid',inScope:true,expected});
    assert.equal(r.error,'invalid_response');
    assert.deepEqual(r.stages,{});
  }
});
