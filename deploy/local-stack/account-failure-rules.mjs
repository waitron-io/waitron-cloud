const groups=['health','account','installations','relay','portal','other','parser'];
const limits=[.05,.1,.5,1,5];
const trendSignals=['disk','memory','load','email','backup_due'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export function parseFailureRules(raw,intervalMs){
 if(raw===undefined||raw==='')return null;
 try{
  const config=JSON.parse(raw);
  if(!exact(config,['failureTargets','fast','slow',...(Object.hasOwn(config??{},'slownessTargets')?['slownessTargets']:[])]))throw Error();
  const targets=config.failureTargets;
  if(!targets||typeof targets!=='object'||Array.isArray(targets)||!Object.keys(targets).length||!Object.entries(targets).every(([group,value])=>groups.includes(group)&&positive(value)&&value<=1))throw Error();
  if(Object.hasOwn(config,'slownessTargets')){
   const slow=config.slownessTargets;
   if(!slow||typeof slow!=='object'||Array.isArray(slow)||!Object.keys(slow).length||!Object.entries(slow).every(([group,value])=>groups.includes(group)&&group!=='parser'&&exact(value,['limitSeconds','allowance'])&&limits.includes(value.limitSeconds)&&positive(value.allowance)&&value.allowance<=1))throw Error();
  }
  for(const rule of [config.fast,config.slow])if(!exact(rule,['windowMs','multiplier'])||!Number.isSafeInteger(rule.windowMs)||rule.windowMs<intervalMs||!positive(rule.multiplier))throw Error();
  return config;
 }catch{throw Error('invalid_account_failure_rules');}
}

export function parseTrendRules(raw,intervalMs){
 if(raw===undefined||raw==='')return null;
 try{
  const config=JSON.parse(raw);
  if(!exact(config,['machine','limits'])||typeof config.machine!=='string'||! /^[a-z0-9_-]{1,32}$/.test(config.machine)||!exact(config.limits,trendSignals))throw Error();
  for(const [signal,rule] of Object.entries(config.limits))if(!exact(rule,['limit','windowMs','horizonMs'])||!positive(rule.limit)
   ||(['disk','memory'].includes(signal)&&rule.limit>1)||!Number.isSafeInteger(rule.windowMs)||rule.windowMs<intervalMs
   ||!Number.isSafeInteger(rule.horizonMs)||rule.horizonMs<=0)throw Error();
  return config;
 }catch{throw Error('invalid_machine_trend_rules');}
}

export function createFailureRules(config,{intervalMs,timeoutMs}){
 return createShareRules(config.failureTargets,config,{intervalMs,timeoutMs},snapshot=>new Map(snapshot.series.map(row=>[
  row.group+':'+row.outcome,[row.total,['success','refused'].includes(row.outcome)?row.total:0]])));
}
export function createSlownessRules(config,options){
 const targets=config.slownessTargets;
 return createShareRules(Object.fromEntries(Object.entries(targets).map(([group,target])=>[group,target.allowance])),config,options,
  snapshot=>new Map(snapshot.series.filter(row=>Object.hasOwn(targets,row.group)).map(row=>[
   row.group+':'+row.outcome,[row.count,row.buckets[limits.indexOf(targets[row.group].limitSeconds)]]])));
}
function createHistory(windowMs,slack,reset=()=>false){
 let samples=[];
 return {push(sample){
  const previous=samples.at(-1);
  if(previous&&(sample.at<previous.at||reset(sample,previous)))samples=[];
  samples.push(sample);
  while(samples.length>1&&samples[1].at<sample.at-windowMs-slack)samples.shift();
 },baseline(nowMs,windowMs){return samples.findLast(sample=>sample.at<=nowMs-windowMs&&sample.at>=nowMs-windowMs-slack);}};
}
export function createTrendRules(config,{intervalMs,timeoutMs}){
 const slack=intervalMs+timeoutMs+2000;
 const histories=Object.fromEntries(Object.entries(config.limits).map(([signal,rule])=>[signal,createHistory(rule.windowMs,slack)]));
 return {update(readings,nowMs){return Object.entries(config.limits).map(([signal,rule])=>{
  const sample=readings[signal];
  if(!sample||!Number.isFinite(sample.value)||sample.value<0||!Number.isFinite(sample.at)||sample.at>nowMs||nowMs>=sample.at+slack)
   return {signal,at:null,ready:false,breached:null};
  histories[signal].push({at:sample.at,value:sample.value});
  const baseline=histories[signal].baseline(sample.at,rule.windowMs),limit=rule.limit*(1-1e-9);
  const ready=sample.value>=limit||Boolean(baseline);
  const increase=baseline?Math.max(0,sample.value-baseline.value):0;
  const projected=baseline?sample.value+increase/(sample.at-baseline.at)*rule.horizonMs:sample.value;
  return {signal,at:sample.at,ready,breached:ready?projected>=limit:null};
 });}};
}
function createShareRules(targets,config,{intervalMs,timeoutMs},project){
 const slack=intervalMs+timeoutMs+2000;
 const history=createHistory(Math.max(config.fast.windowMs,config.slow.windowMs),slack,(current,previous)=>current.startedAt!==previous.startedAt
  ||[...previous.totals].some(([key,counters])=>counters.some((value,i)=>(current.totals.get(key)?.[i]??0)<value)));
 return {update(snapshot,nowMs){
  const totals=project(snapshot);
  history.push({at:nowMs,startedAt:snapshot.startedAt,totals});
  return Object.entries(targets).flatMap(([group,target])=>['fast','slow'].map(rule=>{
   const {windowMs,multiplier}=config[rule];
   const baseline=history.baseline(nowMs,windowMs);
   let total=0,bad=0;
   if(baseline)for(const outcome of ['success','refused','server_error','timed_out']){
    const key=group+':'+outcome,current=totals.get(key)??[0,0],before=baseline.totals.get(key)??[0,0];
    const delta=current[0]-before[0];
    total+=delta;bad+=delta-(current[1]-before[1]);
   }
   const ready=Boolean(baseline)&&total>0;
   // Relative tolerance includes exact decimal boundaries without widening normal below-threshold shares.
   return {group,rule,ready,breached:ready?bad/total>=target*multiplier*(1-1e-9):null};
  }));
 }};
}
