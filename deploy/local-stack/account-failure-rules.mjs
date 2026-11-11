const groups=['health','account','installations','relay','portal','other','parser'];
export function parseFailureRules(raw,intervalMs){
 if(raw===undefined||raw==='')return null;
 try{
  const config=JSON.parse(raw);
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
  if(!exact(config,['failureTargets','fast','slow']))throw Error();
  const targets=config.failureTargets;
  if(!targets||typeof targets!=='object'||Array.isArray(targets)||!Object.keys(targets).length||!Object.entries(targets).every(([group,value])=>groups.includes(group)&&positive(value)&&value<=1))throw Error();
  for(const rule of [config.fast,config.slow])if(!exact(rule,['windowMs','multiplier'])||!Number.isSafeInteger(rule.windowMs)||rule.windowMs<intervalMs||!positive(rule.multiplier))throw Error();
  return config;
 }catch{throw Error('invalid_account_failure_rules');}
}

export function createFailureRules(config,{intervalMs,timeoutMs}){
 let samples=[];
 const slack=intervalMs+timeoutMs+2000;
 const retainedMs=Math.max(config.fast.windowMs,config.slow.windowMs)+slack;
 return {update(snapshot,nowMs){
  const totals=new Map(snapshot.series.map(row=>[row.group+':'+row.outcome,row.total]));
  const previous=samples.at(-1);
  if(previous&&(snapshot.startedAt!==previous.startedAt||nowMs<previous.at||[...previous.totals].some(([key,total])=>(totals.get(key)??0)<total)))samples=[];
  samples.push({at:nowMs,startedAt:snapshot.startedAt,totals});
  while(samples.length>1&&samples[1].at<nowMs-retainedMs)samples.shift();
  return Object.entries(config.failureTargets).flatMap(([group,target])=>['fast','slow'].map(rule=>{
   const {windowMs,multiplier}=config[rule];
   const baseline=samples.findLast(sample=>sample.at<=nowMs-windowMs&&sample.at>=nowMs-windowMs-slack);
   let total=0,bad=0;
   if(baseline)for(const outcome of ['success','refused','server_error','timed_out']){
    const key=group+':'+outcome,delta=(totals.get(key)??0)-(baseline.totals.get(key)??0);
    total+=delta;if(outcome==='server_error'||outcome==='timed_out')bad+=delta;
   }
   const ready=Boolean(baseline)&&total>0;
   // Relative tolerance includes exact decimal boundaries without widening normal below-threshold shares.
   return {group,rule,ready,breached:ready?bad/total>=target*multiplier*(1-1e-9):null};
  }));
 }};
}
