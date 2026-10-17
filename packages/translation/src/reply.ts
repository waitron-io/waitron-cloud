import type {JobItem,ParsedJob} from './job-body.ts';
import type {ItemResult} from './job-store.ts';
import {batchIds} from './prompt.ts';
export class ReplyError extends Error {
 readonly reason:'no_json'|'shape'|'duplicate'|'missing'|'empty';
 constructor(reason:ReplyError['reason']){super(reason);this.name='ReplyError';this.reason=reason;}
}
export function extractJson(text:string):unknown{
 const fenced=/```(?:json)?\s*(\{[\s\S]*\})\s*```/.exec(text);
 const candidate=fenced?fenced[1]!:text.slice(text.indexOf('{'),text.lastIndexOf('}')+1);
 if(!candidate||text.indexOf('{')<0)throw new ReplyError('no_json');
 try{return JSON.parse(candidate);}catch{throw new ReplyError('no_json');}
}
const trimmed=(value:unknown)=>typeof value==='string'?value.trim():'';
const record=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
function listOf(reply:unknown,key:'products'|'changes'):unknown[]{
 const list=record(reply)?.[key];if(!Array.isArray(list))throw new ReplyError('shape');return list;
}
function corrections(value:unknown,enabled:readonly string[]):ItemResult['corrections']{
 const out:ItemResult['corrections']=[];
 for(const raw of Array.isArray(value)?value:[]){
  if(out.length===10)break;
  const c=record(raw);if(!c)continue;
  const field=c.field,wrong=trimmed(c.wrong),right=trimmed(c.right);
  if(typeof field==='string'&&(field==='internal'||enabled.includes(field))&&wrong&&right&&wrong.length<=500&&right.length<=500&&wrong!==right)out.push({field,wrong,right});
 }
 return out;
}
export function checkFirstPass(job:ParsedJob,batch:readonly JobItem[],text:string):ItemResult[]{
 const ids=batchIds(batch),known=new Set(ids),byId=new Map<string,Record<string,unknown>>();
 for(const raw of listOf(extractJson(text),'products')){
  const entry=record(raw),id=entry?.id;
  if(!entry||typeof id!=='string'||!known.has(id))continue;
  if(byId.has(id))throw new ReplyError('duplicate');
  byId.set(id,entry);
 }
 return batch.flatMap((item,i):ItemResult[]=>{
  if(!item.missing.length)return [];
  const entry=byId.get(ids[i]!);
  if(!entry)throw new ReplyError('missing');
  const fixes=corrections(entry.corrections,job.languages.enabled);
  if(entry.placeholder===true)return [{ref:item.ref,names:{},placeholder:true,corrections:fixes}];
  const names:Record<string,string>={};
  for(const lang of item.missing){const name=trimmed(entry[lang]);if(!name||name.length>500)throw new ReplyError('empty');names[lang]=name;}
  return [{ref:item.ref,names,placeholder:false,corrections:fixes}];
 });
}
export function mergeReview(_job:ParsedJob,batch:readonly JobItem[],first:readonly ItemResult[],text:string){
 const changes=listOf(extractJson(text),'changes'),ids=batchIds(batch),items=new Map(batch.map((item,i)=>[ids[i]!,item]));
 const results=first.map(r=>({...r,names:{...r.names},corrections:r.corrections.map(c=>({...c}))}));
 const byRef=new Map(results.map(r=>[r.ref,r])),seen=new Set<string>();
 let applied=0,dropped=0;
 for(const raw of changes){
  const c=record(raw)??{},item=typeof c.id==='string'?items.get(c.id):undefined,result=item?byRef.get(item.ref):undefined;
  const lang=c.language,name=trimmed(c.name);
  if(!item||!result||result.placeholder||typeof lang!=='string'||!item.missing.includes(lang)||lang in item.existing||!name||name.length>500){dropped++;continue;}
  const key=`${c.id}\u001f${lang}`;
  if(seen.has(key)){dropped++;continue;}
  seen.add(key);result.names[lang]=name;applied++;
 }
 return {results,applied,dropped};
}
