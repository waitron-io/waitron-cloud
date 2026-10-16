import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCases} from './address-lookup-evaluation.mjs';

const comparison = await import('./address-lookup-comparison.mjs').catch(() => ({}));
const expected = {street:['Carrer Marina','Calle Marina'],number:'306',postcode:'08025',locality:['Barcelona'],province:['Barcelona'],unit:null};
const entry = {id:'residential-with-postcode',query:'Carrer Marina 306, 08025 Barcelona, España',inScope:true,expected};
const geo = (overrides={}) => ({country_code:'es',street:'Carrer Marina',housenumber:'306',postcode:'08025',city:'Barcelona',county:'Barcelonès',...overrides});
const google = (street='Carrer Marina') => ({result:{address:{postalAddress:{regionCode:'ES',postalCode:'08025',locality:'Barcelona'},addressComponents:[{componentType:'route',componentName:{text:street}},{componentType:'street_number',componentName:{text:'306'}},{componentType:'administrative_area_level_2',componentName:{text:'Barcelona'}}]}}});

// Missing postcode inference and hidden province conflicts would misstate draft quality.
test('province mapping uses returned Spanish evidence and preserves conflicting or missing evidence', () => {
  assert.equal(typeof comparison.mapProvince,'function','province mapping is missing');
  const actual={country:'es',province:'Barcelonès',postcode:'08025'};
  assert.deepEqual(comparison.mapProvince(actual),{...actual,province:'Barcelona',evidence:{supplied:false,inferred:true,conflict:false,unknownSupplied:true}});
  assert.equal(comparison.mapProvince({...actual,province:'Gerona',postcode:'17001'}).province,'Girona');
  assert.equal(comparison.mapProvince({...actual,province:'17',postcode:''}).province,'Girona');
  assert.deepEqual(comparison.mapProvince({...actual,province:'Madrid'}).evidence,{supplied:true,inferred:false,conflict:true,unknownSupplied:false});
  assert.equal(comparison.mapProvince({...actual,province:'Madrid'}).province,'');
  for(const postcode of ['0802','00000','53000',''])assert.equal(comparison.mapProvince({...actual,postcode}).province,'');
  for(const country of ['', 'fr'])assert.equal(comparison.mapProvince({...actual,country}).province,'');
});

// Looking only at result zero would hide a correct later result; sending only a
// matching result for validation would use the answer to improve the provider.
test('Geoapify scores every one of the first five candidates without changing either query', async () => {
  assert.equal(typeof comparison.evaluateListCase,'function','list comparison is missing');
  const calls=[];
  const client={request:async(provider,operation,id,query)=>{calls.push([provider,operation,id,query]);return {results:[geo({street:'Carrer Mallorca'}),geo(),geo({country_code:'fr'}),geo({postcode:'28014',county:'Madrid'}),geo({housenumber:'307'}),geo()]};}};
  const row=await comparison.evaluateListCase(client,'geoapify',entry);
  assert.equal(row.error,null);
  for(const stage of ['autocomplete','geocode']) {
    assert.equal(row.stages[stage].length,5);
    assert.equal(row.stages[stage][0].selectable,false);
    assert.equal(row.stages[stage][1].complete,true);
    assert.equal(row.stages[stage][1].provinceInferred,true);
    assert.equal(row.stages[stage][1].provinceSupplied,false);
    assert.equal(row.stages[stage][2].complete,false);
    assert.equal(row.stages[stage][3].complete,false);
    assert.equal(row.stages[stage][4].complete,false);
  }
  assert.deepEqual(calls,[['geoapify','autocomplete',entry.id,entry.query],['geoapify','geocode',entry.id,entry.query]]);
  assert.ok(!JSON.stringify(row).includes('Marina'),'provider address text must stay out of scores');
});

test('Google validates the bounded list in order, including wrong predictions, using distinct attempt identities', async () => {
  assert.equal(typeof comparison.evaluateListCase,'function','list comparison is missing');
  const calls=[];
  const client={request:async(provider,operation,id,query)=>{
    calls.push([operation,id,query]);
    if(operation==='autocomplete')return {suggestions:Array.from({length:6},(_,i)=>({placePrediction:{text:{text:`public prediction ${i+1}`}}}))};
    if(query==='public prediction 3')throw new Error('http_500');
    return google(query==='public prediction 2'?'Carrer Marina':'Carrer Mallorca');
  }};
  const row=await comparison.evaluateListCase(client,'google',entry);
  assert.equal(row.stages.selection.length,5);
  assert.deepEqual(row.stages.selection.map(x=>x.rank),[1,2,3,4,5]);
  assert.equal(row.stages.selection[0].selectable,false);
  assert.equal(row.stages.selection[1].complete,true);
  assert.equal(row.stages.selection[2].error,'http_500');
  assert.equal(row.stages.selection[3].selectable,false);
  assert.equal(calls.length,6);
  assert.equal(new Set(calls.slice(1).map(call=>call[1])).size,5);
  assert.deepEqual(calls.map(call=>call[2]),[entry.query,...Array.from({length:5},(_,i)=>`public prediction ${i+1}`)]);
  assert.ok(!JSON.stringify(row).includes('public prediction'));
});

test('CartoCiudad resolves each nonpoint candidate by its exact id and type within the five-result bound', async () => {
  assert.equal(typeof comparison.evaluateListCase,'function','list comparison is missing');
  const calls=[];
  const good={countryCode:'011',tip_via:'Calle',address:'MARINA 306, BARCELONA',portalNumber:306,postalCode:'08025',poblacion:'Barcelona',province:'Barcelona'};
  const client={request:async(provider,operation,id,query)=>{
    calls.push([operation,id,query]);
    if(operation==='candidates')return [{...good,lat:41,lng:2,address:'MALLORCA 306, BARCELONA'},...Array.from({length:5},(_,i)=>({id:`point-${i}`,type:'portal'}))];
    return {...good,lat:41,lng:2};
  }};
  const row=await comparison.evaluateListCase(client,'cartociudad',entry);
  assert.equal(row.stages.selection.length,5);
  assert.equal(row.stages.selection[0].selectable,false);
  assert.equal(row.stages.selection[1].complete,true);
  assert.deepEqual(calls.slice(1).map(x=>x[2]),Array.from({length:4},(_,i)=>({id:`point-${i}`,type:'portal'})));
  assert.equal(new Set(calls.slice(1).map(x=>x[1])).size,4);
});

test('a list evaluator can resume durable cases through the existing journal without repeating requests', async () => {
  const directory=mkdtempSync(join(tmpdir(),'address-list-resume-'));
  let calls=0;
  const evaluator=async(client,provider,entry)=>{calls++;return {provider,id:entry.id,inScope:true,stages:{selection:[]},error:null};};
  try {
    const first=await runCases({},'cartociudad',[entry],directory,'fixed-corpus',()=>{},evaluator);
    assert.equal(calls,1,'runCases must use the explicitly supplied evaluator');
    const resumed=await runCases({},'cartociudad',[entry],directory,'fixed-corpus',()=>{},evaluator);
    assert.equal(calls,1);
    assert.deepEqual(resumed,first);
    assert.equal(JSON.parse(readFileSync(join(directory,'cartociudad-scores.jsonl'),'utf8')).id,entry.id);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('list summaries keep errors and empty lists in their denominator and never combine fields from different candidates', () => {
  assert.equal(typeof comparison.summarizeLists,'function','list summary is missing');
  const wrong={rank:1,selectable:false,houseNumber:true,postcode:true,province:true,complete:false,error:null};
  const street={rank:2,selectable:true,houseNumber:false,postcode:false,province:true,complete:false,error:null};
  const full={...street,houseNumber:true,postcode:true,complete:true};
  const rows=[{stages:{selection:[wrong,street]},error:null},{stages:{selection:[full]},error:null},{stages:{selection:[]},error:null},{stages:{},error:'timeout'}];
  assert.deepEqual(comparison.summarizeLists(rows,'selection'),{cases:4,firstSelectable:1,listSelectable:2,firstComplete:1,listComplete:1,noResult:1,caseErrors:1,candidateErrors:0,foreignCountry:0,provinceInferred:0,provinceConflicts:0});
});

test('a shared request-limit exhaustion stops the list without scoring an unsent case', async () => {
  assert.equal(typeof comparison.evaluateListCase,'function','list comparison is missing');
  const {RequestBudget}=await import('./address-lookup-evaluation.mjs');
  const directory=mkdtempSync(join(tmpdir(),'address-list-limit-'));
  const budget=new RequestBudget(directory);
  budget.counts.google=1499;
  try {
    const client={request:async()=>budget.reserve('google','autocomplete',entry.id)};
    await assert.rejects(comparison.evaluateListCase(client,'google',entry),/budget exhausted/);
  } finally {budget.close();rmSync(directory,{recursive:true,force:true});}
});

test('refused keys stop later list validations and malformed candidates cannot become selections', async () => {
  assert.equal(typeof comparison.evaluateListCase,'function','list comparison is missing');
  let calls=0;
  const client={request:async(provider,operation)=>{calls++;if(operation==='autocomplete')return {suggestions:[{}, {placePrediction:{text:{text:'candidate'}}},{placePrediction:{text:{text:'later'}}}]};throw new Error('Provider key refused');}};
  const row=await comparison.evaluateListCase(client,'google',entry);
  assert.equal(row.error,'Provider key refused');
  assert.equal(calls,2);
  assert.equal(row.stages.selection[0].error,'invalid_response');
  assert.equal(row.stages.selection[0].selectable,false);
});

test('the comparison preflight counts both query variants and refuses cumulative provider overspend', () => {
  assert.equal(typeof comparison.comparisonPlan,'function','comparison preflight is missing');
  const cases=Array.from({length:120},(_,i)=>({...entry,id:`case-${i}`,baseId:`base-${Math.floor(i/2)}`,variant:i%2?'without-postcode':'with-postcode',cohort:i<60?'residential':'rural'}));
  const corpus={version:2,cases};
  const counts={google:78,geoapify:80,cartociudad:41};
  assert.deepEqual(comparison.comparisonPlan(corpus,counts),{cases:120,addresses:60,maximumRequests:{google:720,geoapify:240,cartociudad:720},maximumCumulative:{google:798,geoapify:320,cartociudad:761}});
  assert.throws(()=>comparison.comparisonPlan(corpus,{...counts,google:780}),/request budget/);
  assert.throws(()=>comparison.comparisonPlan({...corpus,cases:cases.slice(1)},counts),/corpus/);
  assert.throws(()=>comparison.comparisonPlan({...corpus,cases:cases.map(row=>({...row,id:'duplicate'}))},counts),/corpus/);
  assert.throws(()=>comparison.comparisonPlan({...corpus,cases:cases.map(row=>({...row,variant:'with-postcode'}))},counts),/corpus/);
});

test('the comparison CLI refuses implicit live requests before reading keys or creating a journal', async () => {
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const cli=fileURLToPath(new URL('./address-lookup-comparison.mjs',import.meta.url));
  const child=spawnSync(process.execPath,[cli],{encoding:'utf8'});
  assert.equal(child.status,1);
  assert.match(child.stderr,/Use --run google\|geoapify\|cartociudad/);
});

test('a later provider run retains completed providers counters without reserving their entire corpus twice', () => {
  assert.equal(typeof comparison.comparisonPlan,'function');
  const cases=Array.from({length:120},(_,i)=>({...entry,id:`case-${i}`,baseId:`base-${Math.floor(i/2)}`,variant:i%2?'without-postcode':'with-postcode'}));
  assert.deepEqual(comparison.comparisonPlan({version:2,cases},{google:1499,geoapify:80,cartociudad:41},'geoapify'),{cases:120,addresses:60,maximumRequests:{geoapify:240},maximumCumulative:{google:1499,geoapify:320,cartociudad:41}});
});

test('a supplied province alias counts as supplied evidence after country-pack canonicalization', async () => {
  const client={request:async()=>({results:[geo({city:'Girona',county:'Gerona',postcode:'17001'})]})};
  const row=await comparison.evaluateListCase(client,'geoapify',{...entry,expected:{...expected,province:['Girona'],postcode:'17001',locality:['Girona']}});
  assert.equal(row.stages.autocomplete[0].provinceSupplied,true);
  assert.equal(row.stages.autocomplete[0].provinceInferred,false);
});

test('preflight reserves only unsent durable cases when resuming near the cumulative ceiling', () => {
  const cases=Array.from({length:120},(_,i)=>({...entry,id:`case-${i}`,baseId:`base-${Math.floor(i/2)}`,variant:i%2?'without-postcode':'with-postcode'}));
  const corpus={version:2,cases};
  const done=cases.slice(0,119).map(row=>row.id);
  assert.deepEqual(comparison.comparisonPlan(corpus,{google:1490,geoapify:80,cartociudad:41},'google',done),{cases:120,addresses:60,maximumRequests:{google:6},maximumCumulative:{google:1496,geoapify:80,cartociudad:41}});
  assert.throws(()=>comparison.comparisonPlan(corpus,{google:0,geoapify:0,cartociudad:0},'google',['unrelated-case']),/completed/);
  assert.throws(()=>comparison.comparisonPlan(corpus,{google:0,geoapify:0,cartociudad:0},'google',[done[0],done[0]]),/completed/);
});
