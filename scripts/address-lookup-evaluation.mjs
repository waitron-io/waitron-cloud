import assert from 'node:assert/strict';
import {appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';

export class RequestLimitError extends Error {}

export class RequestBudget {
  counts = {google:0, geoapify:0, cartociudad:0};
  retries = {google:0, geoapify:0, cartociudad:0};
  lastAt = {google:0, geoapify:0, cartociudad:0};
  attempts = new Map();
  #record(event) {
    const key=JSON.stringify([event.provider,event.operation,event.caseId]);
    const attempt=(this.attempts.get(key)??0)+1;
    this.attempts.set(key,attempt);
    if(attempt>1)this.retries[event.provider]++;
    this.lastAt[event.provider]=Math.max(this.lastAt[event.provider],Date.parse(event.at));
    this.counts[event.provider]++;
    return attempt;
  }
  constructor(directory) {
    mkdirSync(directory, {recursive:true, mode:0o700});
    this.lock = join(directory, 'request.lock');
    try { mkdirSync(this.lock); } catch { throw new Error('Request journal is locked; reconcile its owner before resuming'); }
    this.path = join(directory, 'requests.jsonl');
    try {
      if (existsSync(this.path)) {
        const text = readFileSync(this.path, 'utf8');
        assert.ok(!text || text.endsWith('\n'));
        for (const line of text.trimEnd().split('\n').filter(Boolean)) {
          const event = JSON.parse(line);
          assert.ok(Object.hasOwn(this.counts, event.provider));
          assert.equal(event.ordinal, this.counts[event.provider]+1);
          assert.ok(typeof event.operation === 'string' && typeof event.caseId === 'string' && Number.isFinite(Date.parse(event.at)));
          assert.ok(this.#record(event)<=2);
        }
      }
      assert.ok(Object.values(this.counts).every(count => count <= 1499));
    } catch { rmdirSync(this.lock); throw new Error('Invalid request journal; reconcile it before sending'); }
  }
  reserve(provider, operation, caseId) {
    assert.ok(this.lock, 'Request budget is closed');
    assert.ok(Object.hasOwn(this.counts, provider), 'Unknown provider');
    if(this.counts[provider]>=1499)throw new RequestLimitError('Provider request budget exhausted');
    if((this.attempts.get(JSON.stringify([provider,operation,caseId]))??0)>=2)throw new RequestLimitError('Request attempt limit exhausted');
    const event = {provider, operation, caseId, ordinal:this.counts[provider]+1, at:new Date().toISOString()};
    // A crash after reservation consumes the allowance: uncertain sends cannot be free.
    const fd = openSync(this.path, 'a', 0o600);
    try { appendFileSync(fd, JSON.stringify(event)+'\n'); fsyncSync(fd); } finally { closeSync(fd); }
    const directory = openSync(join(this.path, '..'), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
    this.#record(event);
    return event;
  }
  close() { if (this.lock) { rmdirSync(this.lock); this.lock = null; } }
}

export function textKey(text) {
  return String(text??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/\b(?:de|del|la|el|las|los|l|d)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
const matches = (actual, aliases) => Boolean(actual) && aliases.some(value => textKey(value) === textKey(actual));
export function score(expected, actual) {
  const country = actual?.country?.toLowerCase()==='es';
  const locality = matches(actual?.locality, expected.locality);
  const selectable = country && locality && matches(actual?.street, expected.street);
  return {selectable, wrongMatch:Boolean(actual)&&!selectable,
    houseNumber:Boolean(actual)&&expected.number!==null&&String(actual.number)===expected.number,
    postcode:Boolean(actual)&&actual.postcode===expected.postcode, locality,
    province:matches(actual?.province,expected.province), country, foreignCountry:Boolean(actual?.country)&&!country, missingCountry:Boolean(actual)&&!actual.country,
    unit:expected.unit ? textKey(actual?.unit)===textKey(expected.unit) : null, noResult:!actual};
}
export function normalize(provider, data) {
  const empty = {country:'',street:'',number:'',postcode:'',locality:'',province:'',unit:null};
  if (provider==='geoapify') return {...empty,country:data.country_code??'',street:data.street??'',number:data.housenumber??'',postcode:data.postcode??'',locality:data.city||data.town||data.village||'',province:data.county??'',unit:data.unit??null};
  if (provider==='google') {
    const address=data.address??{}, postal=address.postalAddress??{};
    const component = type => address.addressComponents?.find(part=>part.componentType===type)?.componentName?.text??'';
    return {...empty,country:(postal.regionCode??'').toLowerCase(),street:component('route'),number:component('street_number'),postcode:postal.postalCode??'',locality:postal.locality??'',province:component('administrative_area_level_2'),unit:component('subpremise')||null};
  }
  assert.equal(provider,'cartociudad','Unknown provider');
  let street=(data.address??'').split(',')[0].trim();
  if(data.portalNumber!=null) {
    for(const gap of ['', ' ']) {
      const suffix=` ${data.portalNumber}${data.extension?gap+data.extension:''}`;
      if(street.endsWith(suffix)){street=street.slice(0,-suffix.length);break;}
    }
  }
  if(data.noNumber===true) street=street.replace(/\s+s[/-]n$/i,'');
  if(data.tip_via && !textKey(street).startsWith(textKey(data.tip_via)+' ')) street=`${data.tip_via} ${street}`;
  return {...empty,country:data.countryCode==='011'?'es':(data.countryCode??'').toLowerCase(),
    street,number:data.noNumber===true?'':String(data.portalNumber??''),
    postcode:String(data.postalCode??''),locality:data.poblacion||data.muni||'',province:data.province??'',unit:null};
}

export function requestFor(provider, operation, query, keys) {
  let url, options={headers:{Accept:'application/json'},redirect:'error'};
  if (provider==='google') {
    assert.ok(keys.google,'Missing Google key');
    assert.ok(['autocomplete','validation'].includes(operation),'Unauthorised operation');
    url=new URL(operation==='autocomplete'?'https://places.googleapis.com/v1/places:autocomplete':'https://addressvalidation.googleapis.com/v1:validateAddress');
    options={...options,method:'POST',headers:{...options.headers,'Content-Type':'application/json','X-Goog-Api-Key':keys.google},
      body:JSON.stringify(operation==='autocomplete'?{input:query,includedRegionCodes:['es'],languageCode:'es'}:{address:{regionCode:'ES',addressLines:[query]}})};
  } else if (provider==='geoapify') {
    assert.ok(keys.geoapify,'Missing Geoapify key');
    assert.ok(['autocomplete','geocode'].includes(operation),'Unauthorised operation');
    url=new URL(`https://api-eu.geoapify.com/v1/geocode/${operation==='autocomplete'?'autocomplete':'search'}`);
    url.search=new URLSearchParams({text:query,filter:'countrycode:es',lang:'es',format:'json',limit:'5',apiKey:keys.geoapify});
  } else {
    assert.equal(provider,'cartociudad','Unknown provider');
    assert.ok(['candidates','find'].includes(operation),'Unauthorised operation');
    url=new URL(`https://www.cartociudad.es/geocoder/api/geocoder/${operation}`);
    url.search=new URLSearchParams(typeof query==='object'?{id:query.id,type:query.type}:{q:query,countrycodes:'es',limit:'5'});
  }
  return {url,options};
}

function redact(data, keys) {
  if (Array.isArray(data)) return data.map(value=>redact(value,keys));
  if (data && typeof data==='object') return Object.fromEntries(Object.entries(data).map(([key,value])=>[key,redact(value,keys)]));
  if (typeof data!=='string') return data;
  let text=data;
  for (const key of Object.values(keys).filter(Boolean)) text=text.split(key).join('[redacted]');
  return text.replace(/https?:\/\/[^\s<>"']+/g, value=>{try {const url=new URL(value); return url.origin+url.pathname;} catch {return '[url]';}});
}

export class EvaluationClient {
  constructor({budget,directory,keys,fetcher=fetch,spacingMs=1100,timeoutMs=15000}) {
    Object.assign(this,{budget,directory,keys,fetcher,spacingMs,timeoutMs});
    mkdirSync(join(directory,'raw'),{recursive:true,mode:0o700});
    this.measurements=[];
    // A durable reservation can precede dispatch by a slow fsync. A fresh client
    // waits a whole interval instead of treating that old timestamp as dispatch.
    const now=Date.now();
    this.nextAt=performance.now()+Math.max(0,...Object.values(budget.lastAt).map(at=>at-now))+spacingMs;
  }
  async request(provider,operation,caseId,query) {
    const {url,options}=requestFor(provider,operation,query,this.keys);
    // Elapsed time preserves spacing across wall-clock changes. Capped waits
    // prevent a future journal timestamp from overflowing Node's timer to 1 ms.
    for(let wait;(wait=this.nextAt-performance.now())>0;) {
      await new Promise(resolve=>setTimeout(resolve,Math.min(2147483647,Math.ceil(wait))));
    }
    const event=this.budget.reserve(provider,operation,caseId);
    this.nextAt=performance.now()+this.spacingMs;
    const start=performance.now();
    const measurement={...event,endpoint:url.origin+url.pathname,status:null,timeout:false,error:null};
    try {
      const response=await this.fetcher(url,{...options,signal:AbortSignal.timeout(this.timeoutMs)});
      measurement.status=response.status;
      const reader=response.body.getReader();
      const chunks=[]; let size=0;
      try {
        while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error('response_size');chunks.push(Buffer.from(value));}
      } finally {await reader.cancel();}
      let data;
      try {data=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new Error('invalid_json');}
      const raw=openSync(join(this.directory,'raw',`${provider}-${event.ordinal}.json`),'wx',0o600);
      try {appendFileSync(raw,JSON.stringify(redact(data,this.keys)));} finally {closeSync(raw);}
      if(!response.ok) throw new Error(`http_${response.status}`);
      return data;
    } catch(error) {
      measurement.timeout=error.name==='TimeoutError'||error.name==='AbortError';
      // A refused key stays terminal even when its response body cannot be read.
      measurement.error=[401,403].includes(measurement.status)?'key_refused':measurement.timeout?'timeout':['key_refused','response_size','invalid_json'].includes(error.message)||/^http_\d+$/.test(error.message)?error.message:'transport';
      // Transport errors may include a credential-bearing URL; only fixed labels leave memory.
      throw new Error(measurement.error==='key_refused'?'Provider key refused':measurement.error);
    } finally {
      measurement.latencyMs=Math.round(performance.now()-start);
      this.measurements.push(measurement);
      appendFileSync(join(this.directory,'measurements.jsonl'),JSON.stringify(measurement)+'\n',{mode:0o600});
    }
  }
}

export async function evaluateCase(client, provider, entry) {
  const result={provider,id:entry.id,inScope:entry.inScope,stages:{},error:null};
  const request=(operation,query=entry.query)=>client.request(provider,operation,entry.id,query);
  try {
    if(provider==='geoapify') {
      for(const operation of ['autocomplete','geocode']) {
        const data=await request(operation);
        assert.ok(Array.isArray(data.results),'invalid_response');
        result.stages[operation]=score(entry.expected,data.results[0]?normalize(provider,data.results[0]):null);
      }
    } else if(provider==='google') {
      const data=await request('autocomplete');
      assert.ok(data.suggestions===undefined||Array.isArray(data.suggestions),'invalid_response');
      const first=data.suggestions?.[0]?.placePrediction?.text?.text;
      if(first) {
        const validated=await request('validation',first);
        const address=validated.result??validated;
        assert.ok(address.address?.postalAddress,'invalid_response');
        result.stages.selection=score(entry.expected,normalize(provider,address));
      } else result.stages.selection=score(entry.expected,null);
    } else {
      assert.equal(provider,'cartociudad');
      const data=await request('candidates');
      assert.ok(Array.isArray(data),'invalid_response');
      let first=data[0];
      if(first && !(Number.isFinite(first.lat)&&Number.isFinite(first.lng))) {
        assert.ok(first.id&&first.type,'invalid_response');
        first=await request('find',{id:String(first.id),type:first.type});
      }
      result.stages.selection=score(entry.expected,first?normalize(provider,first):null);
    }
  } catch(error) {
    if(error instanceof RequestLimitError)throw error;
    result.error=['timeout','Provider key refused','transport','invalid_json','response_size','invalid_response'].includes(error.message)||/^http_\d+$/.test(error.message)?error.message:'evaluation_error';
  }
  return result;
}

export async function runCases(client,provider,cases,directory,corpusSha256,progress=()=>{},evaluate=evaluateCase) {
  const path=join(directory,`${provider}-scores.jsonl`);
  const existing=existsSync(path)?readFileSync(path,'utf8'):'';
  assert.ok(!existing||existing.endsWith('\n'),'Incomplete corpus score journal');
  const rows=existing.trimEnd().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.ok(rows.every(row=>row.corpusSha256===corpusSha256),'Changed corpus must not reuse scores');
  assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'Duplicate corpus scores');
  if(rows.some(row=>row.error==='Provider key refused')) return rows;
  for(const entry of cases) {
    if(rows.some(row=>row.id===entry.id)) continue;
    const row={...await evaluate(client,provider,entry),corpusSha256};
    const fd=openSync(path,'a',0o600);
    try{appendFileSync(fd,JSON.stringify(row)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
    rows.push(row);
    progress(row);
    if(row.error==='Provider key refused') break;
  }
  return rows;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let budget,run;
  try {
    const provider=process.argv[3];
    assert.ok(process.argv.length===4&&process.argv[2]==='--run'&&['google','geoapify','cartociudad'].includes(provider),'Use --run google|geoapify|cartociudad; live requests require this explicit flag');
    const root=join(homedir(),'waitron-campaign-d','receipts','d75');
    const keys=provider==='cartociudad'?{}:readKeys(join(homedir(),'.waitron-address-lookup','env'));
    assert.ok(provider==='cartociudad'||keys[provider],'Missing provider key');
    const corpusText=readFileSync(new URL('../docs/evaluations/spanish-addresses.json',import.meta.url),'utf8');
    const corpus=JSON.parse(corpusText);
    assert.ok(corpus.version===1&&corpus.cases.length===40&&new Set(corpus.cases.map(row=>row.id)).size===40,'Invalid corpus');
    const corpusSha256=createHash('sha256').update(corpusText).digest('hex');
    budget=new RequestBudget(root);
    run={provider,startedAt:new Date().toISOString(),corpusSha256,initialCount:budget.counts[provider],initialRetries:budget.retries[provider]};
    const client=new EvaluationClient({budget,directory:root,keys});
    const rows=await runCases(client,provider,corpus.cases,root,corpusSha256,row=>console.log(`${provider} ${row.id}: ${row.error??'scored'}; cumulative ${JSON.stringify(budget.counts)}/1499 each`));
    run.completed=rows.length;run.errors=rows.filter(row=>row.error).length;
    if(run.errors)process.exitCode=1;
  } catch(error) {
    if(run)run.error=error instanceof RequestLimitError?'request_limit':'local_error';
    console.error(error.message);
    process.exitCode=1;
  } finally {
    try {
      if(run) {
        const receipt={provider:run.provider,startedAt:run.startedAt,finishedAt:new Date().toISOString(),corpusSha256:run.corpusSha256,
          counts:budget.counts,requestsThisRun:budget.counts[run.provider]-run.initialCount,retries:budget.retries[run.provider],
          retriesThisRun:budget.retries[run.provider]-run.initialRetries,completed:run.completed??null,errors:run.errors??null,error:run.error??null};
        appendFileSync(join(homedir(),'waitron-campaign-d/receipts/d75/runs.jsonl'),JSON.stringify(receipt)+'\n',{mode:0o600});
        console.log(JSON.stringify(receipt));
      }
    } finally {budget?.close();}
  }
}

export function summarize(rows, stage, inScope) {
  const eligible=rows.filter(row=>inScope===undefined||row.inScope===inScope);
  const scored=eligible.flatMap(row=>row.stages[stage]?[row.stages[stage]]:[]);
  const count=key=>scored.filter(row=>row[key]===true).length;
  return {cases:eligible.length,scored:scored.length,errors:eligible.filter(row=>row.error).length,
    selectable:count('selectable'),wrongMatch:count('wrongMatch'),noResult:count('noResult'),
    houseNumber:count('houseNumber'),postcode:count('postcode'),locality:count('locality'),province:count('province'),
    postcodeAndProvinceAmongSelections:scored.filter(row=>row.selectable&&row.postcode&&row.province).length,
    selections:count('selectable'),foreignCountry:count('foreignCountry'),missingCountry:count('missingCountry'),
    unitPreserved:count('unit'),units:scored.filter(row=>row.unit!==null).length};
}

export function readKeys(path) {
  try {
    const env=parseEnv(readFileSync(path,'utf8'));
    return {google:env.GOOGLE_MAPS_SERVER_KEY,geoapify:env.GEOAPIFY_API_KEY};
  } catch {throw new Error('Missing or unreadable provider key file');}
}
