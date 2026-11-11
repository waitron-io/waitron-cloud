const groups=['health','account','installations','relay','portal','other','parser'] as const;
const outcomes=['success','refused','server_error','timed_out'] as const;
const bounds=[.05,.1,.5,1,5,Infinity];
type Group=typeof groups[number];
type Outcome=typeof outcomes[number];
type Series={group:Group;outcome:Outcome;total:number;count:number;sum:number;buckets:number[]};
export type RequestSnapshot={version:1;startedAt:number;series:Series[]};

export function requestGroup(path:string,portal:boolean):Group{
 try{path=new URL(/^https?:\/\//.test(path)?path:'http://localhost'+path).pathname;}catch{return 'other';}
 if(portal&&!path.startsWith('/api/')&&!path.startsWith('/v1/installations/email/'))return 'portal';
 try{path=decodeURI(path);}catch{return 'other';}
 for(const [prefix,group] of [['/api/health','health'],['/api/account','account'],['/api/installations','installations'],['/v1/installations/email','relay']] as const)
  if(path===prefix||path.startsWith(prefix+'/'))return group;
 return 'other';
}
export class RequestMetrics{
 #series=new Map<string,Series>();
 readonly startedAt:number;
 constructor(startedAt=Date.now()){this.startedAt=startedAt;}
 record(group:Group,status:number,seconds?:number){
  const outcome:Outcome=status===408?'timed_out':status>=500?'server_error':status>=400?'refused':'success';
  const key=group+':'+outcome;
  let row=this.#series.get(key);
  if(!row){row={group,outcome,total:0,count:0,sum:0,buckets:bounds.map(()=>0)};this.#series.set(key,row);}
  row.total++;
  if(seconds!==undefined){row.count++;row.sum+=seconds;bounds.forEach((bound,i)=>{if(seconds<=bound)row!.buckets[i]=row!.buckets[i]!+1;});}
 }
 snapshot():RequestSnapshot{return {version:1,startedAt:this.startedAt,series:[...this.#series.values()].map(row=>({...row,buckets:[...row.buckets]}))};}
}

export function parseRequestMetrics(input:unknown):RequestSnapshot{
 function check(value:unknown):asserts value{if(!value)throw Error('Invalid account request metrics');}
 const object=(value:unknown,keys:string[]):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))throw Error('Invalid account request metrics');
  return value as Record<string,unknown>;
 };
 const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
 const data=object(input,['version','startedAt','series']);
 check(data.version===1&&integer(data.startedAt)&&Number(data.startedAt)<=8640000000000000&&Array.isArray(data.series)&&data.series.length<=28);
 const seen=new Set<string>();
 for(const value of data.series as unknown[]){
  const row=object(value,['group','outcome','total','count','sum','buckets']);
  check(groups.includes(row.group as Group)&&outcomes.includes(row.outcome as Outcome)&&integer(row.total)&&integer(row.count)&&Number(row.count)<=Number(row.total)&&typeof row.sum==='number'&&Number.isFinite(row.sum)&&row.sum>=0);
  check(Array.isArray(row.buckets)&&row.buckets.length===6&&row.buckets.every((n,i,a)=>integer(n)&&n<=Number(row.count)&&(i===0||n>=a[i-1]))&&row.buckets[5]===row.count);
  check(row.count!==0||row.sum===0);
  const key=row.group+':'+row.outcome;check(!seen.has(key));seen.add(key);
 }
 return input as RequestSnapshot;
}
export function formatRequestMetrics(input:unknown):string{
 const value=parseRequestMetrics(input);
 let text='# HELP waitron_cloud_account_requests_started_timestamp_seconds Account process start time.\n# TYPE waitron_cloud_account_requests_started_timestamp_seconds gauge\n';
 text+=`waitron_cloud_account_requests_started_timestamp_seconds ${value.startedAt/1000}\n`;
 text+='# HELP waitron_cloud_account_requests_total Completed responses and observed receive failures.\n# TYPE waitron_cloud_account_requests_total counter\n';
 for(const row of value.series){
  const labels=`group="${row.group}",outcome="${row.outcome}"`;
  text+=`waitron_cloud_account_requests_total{${labels}} ${row.total}\n`;
 }
 text+='# HELP waitron_cloud_account_request_duration_seconds Parsed request response or receive timeout duration.\n# TYPE waitron_cloud_account_request_duration_seconds histogram\n';
 for(const row of value.series){
  const labels=`group="${row.group}",outcome="${row.outcome}"`;
  for(const [i,bound] of bounds.entries())text+=`waitron_cloud_account_request_duration_seconds_bucket{${labels},le="${bound===Infinity?'+Inf':bound}"} ${row.buckets[i]}\n`;
  text+=`waitron_cloud_account_request_duration_seconds_sum{${labels}} ${row.sum}\nwaitron_cloud_account_request_duration_seconds_count{${labels}} ${row.count}\n`;
 }
 return text;
}
