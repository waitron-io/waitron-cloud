import type {JobItem,ParsedJob} from './job-body.ts';
import type {ItemResult} from './job-store.ts';
import {ProviderError,type ModelCall,type ModelClient,type ModelReply} from './openai-client.ts';
import {firstPassInput,firstPassInstructions,reviewInput,reviewInstructions} from './prompt.ts';
import {checkFirstPass,mergeReview,ReplyError} from './reply.ts';
export const retryWaitsMs=[2000,8000,30000] as const;
export interface BatchHooks {mayCall():Promise<boolean>;spent(usage:{inputTokens:number;outputTokens:number}):Promise<void>;attempted():Promise<void>;wait(ms:number,signal:AbortSignal):Promise<void>}
export type BatchOutcome={kind:'done';results:ItemResult[];reviewApplied:number;reviewDropped:number;reviewFailed:boolean}|{kind:'failed';reason:'provider_unavailable'|'cap_reached'}|{kind:'aborted'};
type Attempt<T>={ok:true;value:T}|{ok:false;stop:'cap'|'gave_up'|'aborted'};
async function runPass<T>(client:ModelClient,call:ModelCall,check:(text:string)=>T,hooks:BatchHooks,signal:AbortSignal):Promise<Attempt<T>>{
 for(let attempt=0;attempt<=retryWaitsMs.length;attempt++){
  if(signal.aborted)return {ok:false,stop:'aborted'};
  const allowed=await hooks.mayCall();
  if(signal.aborted)return {ok:false,stop:'aborted'};
  if(!allowed)return {ok:false,stop:'cap'};
  let response:{reply:ModelReply}|{error:unknown};
  try{response={reply:await client.respond(call,signal)};}catch(error){response={error};}
  // Storage and lease failures must escape without replaying a paid provider call.
  try{
   const usage='reply' in response?{inputTokens:response.reply.inputTokens,outputTokens:response.reply.outputTokens}
    :response.error instanceof ProviderError?response.error.usage:undefined;
   if(usage)await hooks.spent(usage);
  }finally{await hooks.attempted();}
  if(signal.aborted)return {ok:false,stop:'aborted'};
  let error:unknown;
  if('reply' in response){
   try{return {ok:true,value:check(response.reply.text)};}catch(failure){error=failure;}
  }else error=response.error;
  if(!(error instanceof ProviderError)&&!(error instanceof ReplyError))throw error;
  if(error instanceof ProviderError&&!error.retryable)return {ok:false,stop:'gave_up'};
  if(attempt===retryWaitsMs.length)break;
  const wait=error instanceof ProviderError?error.retryAfterMs:undefined;
  try{await hooks.wait(wait??retryWaitsMs[attempt]!,signal);}catch(failure){if(!signal.aborted)throw failure;}
 }
 return signal.aborted?{ok:false,stop:'aborted'}:{ok:false,stop:'gave_up'};
}
export async function translateBatch(job:ParsedJob,batch:readonly JobItem[],client:ModelClient,hooks:BatchHooks,signal:AbortSignal):Promise<BatchOutcome>{
 const first=await runPass(client,{instructions:firstPassInstructions(job),input:firstPassInput(job,batch),effort:'low'},text=>checkFirstPass(job,batch,text),hooks,signal);
 if(!first.ok)return first.stop==='aborted'?{kind:'aborted'}:{kind:'failed',reason:first.stop==='cap'?'cap_reached':'provider_unavailable'};
 const input=reviewInput(job,batch,first.value);
 if(!input)return {kind:'done',results:first.value,reviewApplied:0,reviewDropped:0,reviewFailed:false};
 const review=await runPass(client,{instructions:reviewInstructions(job),input,effort:'medium'},text=>mergeReview(job,batch,first.value,text),hooks,signal);
 if(!review.ok){
  if(review.stop==='aborted')return {kind:'aborted'};
  return {kind:'done',results:first.value,reviewApplied:0,reviewDropped:0,reviewFailed:review.stop==='gave_up'};
 }
 return {kind:'done',results:review.value.results,reviewApplied:review.value.applied,reviewDropped:review.value.dropped,reviewFailed:false};
}
