import assert from 'node:assert/strict';
import {appendFileSync, existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {normalize, score, textKey, RequestLimitError, RequestBudget, EvaluationClient, readKeys, runCases} from './address-lookup-evaluation.mjs';

const {provinces}=JSON.parse(readFileSync(new URL('../docs/evaluations/spanish-provinces.json',import.meta.url),'utf8'));
const byCode=new Map(provinces.map(row=>[row.code,row]));
const byName=new Map(provinces.flatMap(row=>[row.name,...row.aliases,row.code].map(name=>[textKey(name),row])));

export function mapProvince(actual) {
  const spanish=String(actual.country).toLowerCase()==='es';
  const supplied=spanish?byName.get(textKey(actual.province)):null;
  const postal=spanish&&/^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/.test(actual.postcode)?byCode.get(actual.postcode.slice(0,2)):null;
  const conflict=Boolean(supplied&&postal&&supplied.code!==postal.code);
  return {...actual,province:conflict?'':(supplied??postal)?.name??'',evidence:{
    supplied:Boolean(supplied),inferred:Boolean(!supplied&&postal),conflict,unknownSupplied:Boolean(actual.province&&!supplied),
  }};
}

function candidateScore(expected,provider,data,rank) {
  const original=normalize(provider,data);
  const mapped=mapProvince(original);
  const scored=score(expected,mapped);
  return {...scored,rank,error:null,provinceSupplied:mapped.evidence.supplied&&score(expected,{...original,province:byName.get(textKey(original.province))?.name}).province,
    provinceInferred:mapped.evidence.inferred,provinceConflict:mapped.evidence.conflict,
    unknownProvince:mapped.evidence.unknownSupplied,
    complete:scored.selectable&&scored.houseNumber&&scored.postcode&&scored.province&&!mapped.evidence.conflict};
}

function errorLabel(error) {
  return ['timeout','Provider key refused','transport','invalid_json','response_size','invalid_response'].includes(error.message)||/^http_\d+$/.test(error.message)?error.message:'evaluation_error';
}

export async function evaluateListCase(client,provider,entry) {
  const result={provider,id:entry.id,inScope:entry.inScope,stages:{},error:null};
  const request=(operation,query=entry.query,suffix='')=>client.request(provider,operation,entry.id+suffix,query);
  const candidates=async(stage,items,resolve)=>{
    assert.ok(Array.isArray(items),'invalid_response');
    result.stages[stage]=[];
    for(const [index,item] of items.slice(0,5).entries()) {
      try {
        assert.ok(item&&typeof item==='object','invalid_response');
        const resolved=resolve?await resolve(item,index):item;
        assert.ok(resolved&&typeof resolved==='object'&&!Array.isArray(resolved)&&Object.keys(resolved).length>0,'invalid_response');
        result.stages[stage].push(candidateScore(entry.expected,provider,resolved,index+1));
      } catch(error) {
        if(error instanceof RequestLimitError||error.message==='Provider key refused')throw error;
        result.stages[stage].push({...score(entry.expected,null),rank:index+1,error:errorLabel(error),complete:false,
          provinceSupplied:false,provinceInferred:false,provinceConflict:false,unknownProvince:false});
      }
    }
  };
  try {
    if(provider==='geoapify') {
      for(const operation of ['autocomplete','geocode']) {
        try {
          const data=await request(operation);
          await candidates(operation,data.results);
        } catch(error) {
          if(error instanceof RequestLimitError||error.message==='Provider key refused')throw error;
          (result.stageErrors??={})[operation]=errorLabel(error);
        }
      }
    } else if(provider==='google') {
      const data=await request('autocomplete');
      assert.ok(data.suggestions===undefined||Array.isArray(data.suggestions),'invalid_response');
      await candidates('selection',data.suggestions??[],async(item,index)=>{
        const text=item.placePrediction?.text?.text;
        assert.ok(typeof text==='string'&&text.trim(),'invalid_response');
        const data=await request('validation',text,`/rank-${index+1}`);
        const address=data.result??data;
        assert.ok(address.address?.postalAddress,'invalid_response');
        return address;
      });
    } else {
      assert.equal(provider,'cartociudad','Unknown provider');
      const data=await request('candidates');
      await candidates('selection',data,async(item,index)=>{
        if(Number.isFinite(item.lat)&&Number.isFinite(item.lng))return item;
        assert.ok(item.id&&item.type,'invalid_response');
        return request('find',{id:String(item.id),type:item.type},`/rank-${index+1}`);
      });
    }
  } catch(error) {
    if(error instanceof RequestLimitError)throw error;
    result.error=errorLabel(error);
  }
  return result;
}

export function summarizeLists(rows,stage) {
  const lists=rows.map(row=>row.stages[stage]);
  const candidates=lists.flatMap(list=>list??[]);
  return {cases:rows.length,
    firstSelectable:lists.filter(list=>list?.[0]?.selectable).length,
    listSelectable:lists.filter(list=>list?.some(item=>item.selectable)).length,
    firstComplete:lists.filter(list=>list?.[0]?.complete).length,
    listComplete:lists.filter(list=>list?.some(item=>item.complete)).length,
    noResult:lists.filter(list=>list?.length===0).length,caseErrors:rows.filter(row=>row.error||row.stageErrors?.[stage]).length,
    candidateErrors:candidates.filter(item=>item.error).length,
    foreignCountry:candidates.filter(item=>item.foreignCountry).length,
    provinceInferred:candidates.filter(item=>item.provinceInferred).length,
    provinceConflicts:candidates.filter(item=>item.provinceConflict).length,
    candidates:candidates.length,provinceSupplied:candidates.filter(item=>item.provinceSupplied).length,
    unknownProvince:candidates.filter(item=>item.unknownProvince).length,missingCountry:candidates.filter(item=>item.missingCountry).length};
}

export function comparisonPlan(corpus,counts,provider,completed=[]) {
  assert.ok(corpus.version===2&&Array.isArray(corpus.cases)&&corpus.cases.length===120,'Invalid comparison corpus');
  assert.equal(new Set(corpus.cases.map(row=>row.id)).size,120,'Invalid comparison corpus identities');
  const groups=Map.groupBy(corpus.cases,row=>row.baseId);
  assert.equal(groups.size,60,'Invalid comparison corpus address count');
  for(const rows of groups.values())assert.deepEqual(rows.map(row=>row.variant).sort(),['with-postcode','without-postcode'],'Invalid comparison corpus query pairs');
  const limits={google:720,geoapify:240,cartociudad:720};
  assert.ok(provider===undefined||Object.hasOwn(limits,provider),'Unknown provider');
  const ids=new Set(corpus.cases.map(row=>row.id));
  assert.ok(new Set(completed).size===completed.length&&completed.every(id=>ids.has(id)),'Invalid completed corpus cases');
  const maximumRequests=provider?{[provider]:(120-completed.length)*limits[provider]/120}:limits;
  const maximumCumulative={...counts};
  for(const [provider,requests] of Object.entries(maximumRequests)) {
    assert.ok(Number.isSafeInteger(counts[provider])&&counts[provider]>=0,'Invalid request counter');
    maximumCumulative[provider]=counts[provider]+requests;
    assert.ok(maximumCumulative[provider]<=1499,'Comparison would exceed shared provider request budget');
  }
  return {cases:120,addresses:60,maximumRequests,maximumCumulative};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let budget,run;
  const directory=join(homedir(),'waitron-campaign-d/receipts/d76');
  try {
    const provider=process.argv[3];
    assert.ok(process.argv.length===4&&process.argv[2]==='--run'&&['google','geoapify','cartociudad'].includes(provider),'Use --run google|geoapify|cartociudad; live requests require this explicit flag');
    const keys=provider==='cartociudad'?{}:readKeys(join(homedir(),'.waitron-address-lookup/env'));
    assert.ok(provider==='cartociudad'||keys[provider],'Missing provider key');
    const corpusText=readFileSync(new URL('../docs/evaluations/spanish-residential-addresses.json',import.meta.url),'utf8');
    const corpus=JSON.parse(corpusText);
    const corpusSha256=createHash('sha256').update(corpusText).digest('hex');
    budget=new RequestBudget(join(homedir(),'waitron-campaign-d/receipts/d75'));
    const scorePath=join(directory,`${provider}-scores.jsonl`);
    const saved=existsSync(scorePath)?readFileSync(scorePath,'utf8'):'';
    assert.ok(!saved||saved.endsWith('\n'),'Incomplete comparison score journal');
    const completed=saved.trimEnd().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    assert.ok(completed.every(row=>row.corpusSha256===corpusSha256&&row.provider===provider),'Changed corpus or provider must not reuse scores');
    const plan=comparisonPlan(corpus,budget.counts,provider,completed.map(row=>row.id));
    run={provider,startedAt:new Date().toISOString(),corpusSha256,plan,initialCount:budget.counts[provider],initialRetries:budget.retries[provider]};
    const client=new EvaluationClient({budget,directory,keys});
    const rows=await runCases(client,provider,corpus.cases,directory,corpusSha256,row=>console.log(`${provider} ${row.id}: ${row.error??'scored'}; cumulative ${JSON.stringify(budget.counts)}/1499 each`),evaluateListCase);
    run.completed=rows.length;
    run.caseErrors=rows.filter(row=>row.error||Object.keys(row.stageErrors??{}).length).length;
    run.candidateErrors=rows.flatMap(row=>Object.values(row.stages).flat()).filter(row=>row.error).length;
    if(run.caseErrors||run.candidateErrors)process.exitCode=1;
  } catch(error) {
    if(run)run.error=error instanceof RequestLimitError?'request_limit':'local_error';
    const fixedMessages=new Set([
      'Use --run google|geoapify|cartociudad; live requests require this explicit flag',
      'Missing provider key','Missing or unreadable provider key file',
      'Request journal is locked; reconcile its owner before resuming',
      'Invalid request journal; reconcile it before sending',
      'Invalid comparison corpus','Invalid comparison corpus identities',
      'Invalid comparison corpus address count','Invalid comparison corpus query pairs',
      'Invalid completed corpus cases','Invalid request counter',
      'Comparison would exceed shared provider request budget',
      'Incomplete comparison score journal','Changed corpus or provider must not reuse scores',
      'Changed corpus must not reuse scores','Duplicate corpus scores','Incomplete corpus score journal',
    ]);
    const message=String(error?.message??'').split('\n')[0];
    console.error(error instanceof RequestLimitError?'Provider request limit reached':fixedMessages.has(message)?message:'Comparison stopped; check local setup or the per-case fixed error labels');
    process.exitCode=1;
  } finally {
    try {
      if(run) {
        const receipt={...run,finishedAt:new Date().toISOString(),counts:budget.counts,
          requestsThisRun:budget.counts[run.provider]-run.initialCount,retries:budget.retries[run.provider],
          retriesThisRun:budget.retries[run.provider]-run.initialRetries};
        appendFileSync(join(directory,'runs.jsonl'),JSON.stringify(receipt)+'\n',{mode:0o600});
        console.log(JSON.stringify(receipt));
      }
    } finally {budget?.close();}
  }
}
