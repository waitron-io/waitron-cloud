import {TranslationError} from './errors.ts';
export type {ItemResult} from './job-store.ts';
import type {ItemResult} from './job-store.ts';
export const maxCollectBytes=16777216;
export type BatchResults=Record<string,{results:ItemResult[];failed:string[];stoppedByCap?:true}>;
export interface CollectPage {version:1;jobId:string;state:'done'|'partly_done';results:ItemResult[];failed:string[];nextCursor:number|null}
export function collectPage(jobId:string,state:CollectPage['state'],items:readonly {ref:string;missing:readonly string[]}[],batches:BatchResults,cursor:unknown=0):CollectPage{
 const refs=items.filter(item=>item.missing.length>0).map(item=>item.ref);
 if(!Number.isSafeInteger(cursor)||Number(cursor)<0||Number(cursor)>=refs.length)throw new TranslationError('invalid_request');
 const outcomes=new Map<string,ItemResult|null>(),expected=new Set(refs);
 const add=(ref:string,result:ItemResult|null)=>{
  if(!expected.has(ref)||outcomes.has(ref))throw new Error('translation_outcomes_invalid');
  outcomes.set(ref,result);
 };
 for(const batch of Object.values(batches)){
  for(const result of batch.results)add(result.ref,result);
  for(const ref of batch.failed)add(ref,null);
 }
 if(expected.size!==refs.length||outcomes.size!==refs.length)throw new Error('translation_outcomes_invalid');
 let resultBytes=0,failedBytes=0,resultsCount=0,failedCount=0,end=Number(cursor);
 // Each candidate includes its actual continuation; the final null may have another byte length.
 for(let i=Number(cursor);i<refs.length;i++){
  const ref=refs[i]!,value=outcomes.get(ref)!;
  if(value===null){failedBytes+=Buffer.byteLength(JSON.stringify(ref))+(failedCount++?1:0);}
  else {resultBytes+=Buffer.byteLength(JSON.stringify(value))+(resultsCount++?1:0);}
  const envelope:CollectPage={version:1,jobId,state,results:[],failed:[],nextCursor:i+1===refs.length?null:i+1};
  if(Buffer.byteLength(JSON.stringify(envelope))+resultBytes+failedBytes<=maxCollectBytes)end=i+1;
 }
 if(end===cursor)throw new Error('translation_outcome_too_large');
 const results:ItemResult[]=[],failed:string[]=[];
 for(const ref of refs.slice(Number(cursor),end)){
  const value=outcomes.get(ref)!;
  if(value===null)failed.push(ref);else results.push(value);
 }
 return {version:1,jobId,state,results,failed,nextCursor:end===refs.length?null:end};
}
