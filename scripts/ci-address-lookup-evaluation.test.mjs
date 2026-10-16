import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdirSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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
    const events = Array.from({length: 1499}, (_, i) => JSON.stringify({provider:'google',operation:'autocomplete',caseId:`fixture-${i}`,ordinal:i+1,at:'2026-10-16T00:00:00.000Z'})).join('\n')+'\n';
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
  assert.deepEqual(module.score(expected, good), {selectable:true,wrongMatch:false,houseNumber:true,postcode:true,locality:true,province:true,country:true,foreignCountry:false,missingCountry:false,unit:null,noResult:false});
  for (const field of ['country','street','locality']) assert.equal(module.score(expected, {...good,[field]:'wrong'}).selectable, false);
  for (const field of ['number','postcode','province']) assert.equal(module.score(expected, {...good,[field]:''})[field==='number'?'houseNumber':field], false);
  assert.equal(module.score(expected, null).noResult,true);
  assert.equal(module.score(expected, {...good,country:'fr'}).foreignCountry,true);
  assert.equal(module.score(expected, {...good,country:''}).missingCountry,true);
  assert.equal(module.score(expected, {...good,country:''}).foreignCountry,false);
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

test('summary keeps failed and empty cases in the selection denominator and uses only selections for component accuracy', () => {
  assert.equal(typeof module.summarize,'function','result summary is missing');
  const selected={selectable:true,wrongMatch:false,houseNumber:true,postcode:false,province:true,locality:true,country:true,foreignCountry:false,missingCountry:false,noResult:false,unit:null};
  const rows=[{inScope:true,stages:{selection:selected},error:null},{inScope:true,stages:{},error:'timeout'},{inScope:true,stages:{selection:{...selected,selectable:false,noResult:true,houseNumber:false,locality:false,province:false,country:false}},error:null},{inScope:false,stages:{selection:selected},error:null}];
  const out=module.summarize(rows,'selection',true);
  assert.deepEqual(out,{cases:3,scored:2,errors:1,selectable:1,wrongMatch:0,noResult:1,houseNumber:1,postcode:0,locality:1,province:1,postcodeAndProvinceAmongSelections:0,selections:1,foreignCountry:0,missingCountry:0,unitPreserved:0,units:0});
});

test('a refused key with an HTML body still blocks the corpus after one dispatch', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-refused-'));
  const budget=new module.RequestBudget(directory);
  let calls=0;
  try {
    const client=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:0,fetcher:async()=>{calls++;return new Response('<h1>Forbidden</h1>',{status:403});}});
    const rows=await module.runCases(client,'google',[{id:'1',query:'Madrid',inScope:true,expected},{id:'2',query:'Madrid',inScope:true,expected}],directory,'c'.repeat(64));
    assert.equal(rows[0].error,'Provider key refused');
    assert.equal(calls,1);
  } finally {budget.close();rmSync(directory,{recursive:true,force:true});}
});

test('keys come only from the named runtime file, without importing inherited environment values', () => {
  assert.equal(typeof module.readKeys,'function','runtime file key reader is missing');
  const directory=mkdtempSync(join(tmpdir(),'address-keys-'));
  try {
    const path=join(directory,'env');
    writeFileSync(path,'GOOGLE_MAPS_SERVER_KEY="file-google"\nGEOAPIFY_API_KEY=file-geo\nOTHER_VALUE=ignored\n');
    assert.deepEqual(module.readKeys(path),{google:'file-google',geoapify:'file-geo'});
    assert.throws(()=>module.readKeys(join(directory,'missing')),/key file/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('CartoCiudad full address labels do not duplicate the street type or retain the returned number and municipality in the street', () => {
  const actual=module.normalize('cartociudad',{countryCode:'011',tip_via:'PLAZA',address:'PLAZA CIBELES 1, Madrid',portalNumber:1,postalCode:'28014',muni:'Madrid',province:'Madrid'});
  assert.equal(module.score(expected,actual).selectable,true);
  assert.equal(actual.street,'PLAZA CIBELES');
  assert.equal(actual.number,'1');
  assert.equal(module.normalize('cartociudad',{tip_via:'CALLE',address:'PRIMERO DE MAYO 12, Madrid',portalNumber:12}).street,'CALLE PRIMERO DE MAYO');
});

test('a refused-key response with an oversized body still stops after one attempt', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-refusal-body-'));
  const budget=new module.RequestBudget(directory);
  let calls=0;
  try {
    const client=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:0,fetcher:async()=>{calls++;return new Response('x'.repeat(2*1024*1024+1),{status:403});}});
    const rows=await module.runCases(client,'google',[{id:'first',query:'Madrid',inScope:true,expected},{id:'second',query:'Madrid',inScope:true,expected}],directory,'d'.repeat(64));
    assert.equal(rows[0].error,'Provider key refused');
    assert.equal(calls,1);
  }finally{budget.close();rmSync(directory,{recursive:true,force:true});}
});

test('budget exhaustion stops before writing scores for unsent cases', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-exhausted-'));
  try {
    writeFileSync(join(directory,'requests.jsonl'),Array.from({length:1499},(_,i)=>JSON.stringify({provider:'google',operation:'autocomplete',caseId:`case-${i}`,ordinal:i+1,at:'2026-10-16T00:00:00.000Z'})).join('\n')+'\n');
    const budget=new module.RequestBudget(directory);let calls=0;
    try {
      const client=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:0,fetcher:async()=>{calls++;return new Response('{}');}});
      await assert.rejects(module.runCases(client,'google',[{id:'unsent',query:'Madrid',inScope:true,expected}],directory,'e'.repeat(64)),/budget exhausted/);
      assert.equal(calls,0);
      assert.equal(readFileSync(join(directory,'requests.jsonl'),'utf8').trim().split('\n').length,1499);
      assert.throws(()=>readFileSync(join(directory,'google-scores.jsonl')), {code:'ENOENT'});
    }finally{budget.close();}
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('request spacing survives closing and reopening the journal', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-spacing-'));
  const arrivals=[];let budget;
  const fetcher=async()=>{arrivals.push(performance.now());return new Response('{}');};
  try {
    budget=new module.RequestBudget(directory);
    let client=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:100,fetcher});
    await client.request('google','autocomplete','one','Madrid');
    await client.request('google','autocomplete','two','Madrid');
    budget.close();budget=new module.RequestBudget(directory);
    client=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:100,fetcher});
    await client.request('google','autocomplete','three','Madrid');
    assert.ok(arrivals[1]-arrivals[0]>=90,'same-process spacing was bypassed');
    assert.ok(arrivals[2]-arrivals[1]>=90,'restart spacing was bypassed');
  }finally{budget?.close();rmSync(directory,{recursive:true,force:true});}
});

test('crash reservations count as retries on resume and cannot allow a third attempt for the same operation', () => {
  const directory=mkdtempSync(join(tmpdir(),'address-retries-'));let budget;
  try {
    budget=new module.RequestBudget(directory);budget.reserve('google','autocomplete','interrupted');budget.close();
    budget=new module.RequestBudget(directory);budget.reserve('google','autocomplete','interrupted');
    assert.equal(budget.retries?.google,1);
    assert.throws(()=>budget.reserve('google','autocomplete','interrupted'),/attempt limit/);
    budget.reserve('google','validation','interrupted');
    assert.equal(budget.counts.google,3);
    budget.close();budget=new module.RequestBudget(directory);
    assert.equal(budget.retries.google,1);
    assert.throws(()=>budget.reserve('google','autocomplete','interrupted'),/attempt limit/);
  }finally{budget?.close();rmSync(directory,{recursive:true,force:true});}
});

test('empty Geoapify city falls through to town', () => {
  assert.equal(module.normalize('geoapify',{city:'',town:'Besalú'}).locality,'Besalú');
});

test('spaced CartoCiudad number extensions leave the street intact', () => {
  assert.equal(module.normalize('cartociudad',{address:'MAYOR 12 B, Madrid',tip_via:'CALLE',portalNumber:12,extension:'B'}).street,'CALLE MAYOR');
});

test('the command writes request and retry counters even when its limit stops the run', () => {
  const home=mkdtempSync(join(tmpdir(),'address-cli-limit-'));
  try {
    const directory=join(home,'waitron-campaign-d/receipts/d75');mkdirSync(directory,{recursive:true});
    const keyDir=join(home,'.waitron-address-lookup');mkdirSync(keyDir);writeFileSync(join(keyDir,'env'),'GOOGLE_MAPS_SERVER_KEY=offline-test\n');
    writeFileSync(join(directory,'requests.jsonl'),Array.from({length:1499},(_,i)=>JSON.stringify({provider:'google',operation:'autocomplete',caseId:`case-${i}`,ordinal:i+1,at:'2026-10-16T00:00:00.000Z'})).join('\n')+'\n');
    const run=spawnSync(process.execPath,['--import','data:text/javascript,globalThis.fetch=async()=>{throw new Error("offline transport");};',fileURLToPath(new URL('./address-lookup-evaluation.mjs',import.meta.url)),'--run','google'],{env:{...process.env,HOME:home},encoding:'utf8',timeout:5000});
    assert.equal(run.status,1,run.stderr);
    const receipt=JSON.parse(readFileSync(join(directory,'runs.jsonl'),'utf8').trim());
    assert.equal(receipt.error,'request_limit');
    assert.equal(receipt.counts.google,1499);
    assert.equal(receipt.requestsThisRun,0);
    assert.equal(receipt.retries,0);
    assert.throws(()=>readFileSync(join(directory,'google-scores.jsonl')),{code:'ENOENT'});
  }finally{rmSync(home,{recursive:true,force:true});}
});

test('valid-JSON torn journals, gapped ordinals and over-limit journals are refused and release their lock', () => {
  const directory=mkdtempSync(join(tmpdir(),'address-invalid-journals-'));
  const event={provider:'google',operation:'autocomplete',caseId:'fixture',ordinal:1,at:'2026-10-16T00:00:00.000Z'};
  try {
    const inputs=[JSON.stringify(event),JSON.stringify({...event,ordinal:2})+'\n',Array.from({length:1500},(_,i)=>JSON.stringify({...event,caseId:`fixture-${i}`,ordinal:i+1})).join('\n')+'\n',Array.from({length:3},(_,i)=>JSON.stringify({...event,ordinal:i+1})).join('\n')+'\n'];
    for(const input of inputs) {
      writeFileSync(join(directory,'requests.jsonl'),input);
      assert.throws(()=>new module.RequestBudget(directory),/journal/);
      assert.equal(existsSync(join(directory,'request.lock')),false,'invalid journal left its lock');
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('duplicate score rows are refused before any provider call', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-duplicate-scores-'));
  try {
    const row={provider:'google',id:'first',inScope:true,error:null,stages:{},corpusSha256:'e'.repeat(64)};
    writeFileSync(join(directory,'google-scores.jsonl'),JSON.stringify(row)+'\n'+JSON.stringify(row)+'\n');
    let calls=0;
    await assert.rejects(module.runCases({request:async()=>{calls++;return {}; }},'google',[{id:'first',query:'Madrid',inScope:true,expected}],directory,'e'.repeat(64)),/Duplicate corpus scores/);
    assert.equal(calls,0);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('transport exceptions cannot put credential-bearing text into errors or measurements', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-error-label-'));
  const budget=new module.RequestBudget(directory);
  try {
    const client=new module.EvaluationClient({budget,directory,keys:{google:'key-marker'},spacingMs:0,fetcher:async()=>{throw new TypeError('key-marker https://example.test/?key=key-marker');}});
    await assert.rejects(client.request('google','autocomplete','case','Madrid'),e=>e.message==='transport');
    assert.ok(!readFileSync(join(directory,'measurements.jsonl'),'utf8').includes('key-marker'));
    assert.equal(budget.counts.google,1);
  }finally{budget.close();rmSync(directory,{recursive:true,force:true});}
});

test('the response cap refuses oversized successful payloads and existing raw evidence cannot be overwritten', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-response-cap-'));
  const budget=new module.RequestBudget(directory);
  try {
    const client=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:0,fetcher:async()=>new Response(JSON.stringify({large:'x'.repeat(2*1024*1024)}))});
    await assert.rejects(client.request('google','autocomplete','large','Madrid'),/response_size/);
    assert.equal(existsSync(join(directory,'raw/google-1.json')),false);
    writeFileSync(join(directory,'raw/google-2.json'),'first evidence');
    const small=new module.EvaluationClient({budget,directory,keys:{google:'secret'},spacingMs:0,fetcher:async()=>new Response('{}')});
    await assert.rejects(small.request('google','autocomplete','small','Madrid'),/transport/);
    assert.equal(readFileSync(join(directory,'raw/google-2.json'),'utf8'),'first evidence');
  }finally{budget.close();rmSync(directory,{recursive:true,force:true});}
});

test('the real HTTP deadline aborts both missing headers and a body that never finishes', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-http-deadline-'));
  const budget=new module.RequestBudget(directory);
  let hits=0;
  const server=createServer((request,response)=>{hits++;if(request.url==='/body'){response.writeHead(200,{'Content-Type':'application/json'});response.write('{"unfinished":');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for(const path of ['/headers','/body']) {
      const client=new module.EvaluationClient({budget,directory,keys:{google:'offline-key'},spacingMs:0,timeoutMs:100,fetcher:(_url,options)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,options)});
      let timer;
      const request=client.request('google','autocomplete',path,'Madrid').then(()=> 'returned',e=>e.message);
      try {
        const outcome=await Promise.race([request,new Promise(resolve=>{timer=setTimeout(()=>resolve('watchdog'),1500);})]);
        assert.equal(outcome,'timeout');
        assert.equal(client.measurements[0].timeout,true);
      }finally{clearTimeout(timer);}
    }
    assert.equal(hits,2);
    assert.equal(budget.counts.google,2);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));budget.close();rmSync(directory,{recursive:true,force:true});}
});
