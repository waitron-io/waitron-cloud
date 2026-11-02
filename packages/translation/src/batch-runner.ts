import type {JobItem,ParsedJob} from './job-body.ts';
import type {ItemResult} from './job-store.ts';
import {ProviderError,type ModelCall,type ModelClient,type ModelReply} from './openai-client.ts';
import {firstPassInput,firstPassInstructions,reviewInput,reviewInstructions} from './prompt.ts';
import {checkFirstPass,mergeReview,ReplyError} from './reply.ts';
export const retryWaitsMs=[2000,8000,30000] as const;
export interface BatchHooks {stillPermitted?():Promise<boolean>;mayCall():Promise<boolean>;beforeProvider?():Promise<boolean>;spent(usage:{inputTokens:number;outputTokens:number}):Promise<void>;attempted(attemptStartedAt?:string):Promise<void>;wait(ms:number,signal:AbortSignal):Promise<void>}
export type BatchOutcome={kind:'done';results:ItemResult[];reviewApplied:number;reviewDropped:number;reviewFailed:boolean}|{kind:'failed';reason:'provider_unavailable'|'cap_reached'}|{kind:'aborted'};
type Attempt<T>={ok:true;value:T;permitted:boolean}|{ok:false;stop:'cap'|'gave_up'|'aborted'|'permission'};
async function permitted(hooks:BatchHooks,signal:AbortSignal):Promise<'allowed'|'permission'|'aborted'>{
 const allowed=await hooks.stillPermitted?.()??true;
 return signal.aborted?'aborted':allowed?'allowed':'permission';
}
async function runPass<T>(client:ModelClient,call:ModelCall,check:(text:string)=>T,hooks:BatchHooks,signal:AbortSignal):Promise<Attempt<T>>{
 for(let attempt=0;attempt<=retryWaitsMs.length;attempt++){
  if(signal.aborted)return {ok:false,stop:'aborted'};
  const before=await permitted(hooks,signal);
  if(before!=='allowed')return {ok:false,stop:before};
  const allowed=await hooks.mayCall();
  if(signal.aborted)return {ok:false,stop:'aborted'};
  if(!allowed)return {ok:false,stop:'cap'};
  const admission=await permitted(hooks,signal);
  if(admission!=='allowed')return {ok:false,stop:admission};
  if(hooks.beforeProvider){
   const admitted=await hooks.beforeProvider();
   if(signal.aborted)return {ok:false,stop:'aborted'};
   if(!admitted)return {ok:false,stop:'permission'};
   const current=await permitted(hooks,signal);
   if(current!=='allowed')return {ok:false,stop:current};
  }
  let response:{reply:ModelReply}|{error:unknown};
  // Trial use belongs to the invocation day, even if the provider replies after midnight.
  const attemptStartedAt=new Date().toISOString();
  try{response={reply:await client.respond(call,signal)};}catch(error){response={error};}
  // Storage and lease failures must escape without replaying a paid provider call.
  const callbackErrors:unknown[]=[];
  try{
   const usage='reply' in response?{inputTokens:response.reply.inputTokens,outputTokens:response.reply.outputTokens}
    :response.error instanceof ProviderError?response.error.usage:undefined;
   if(usage)await hooks.spent(usage);
  }catch(error){callbackErrors.push(error);}
  try{await hooks.attempted(attemptStartedAt);}catch(error){callbackErrors.push(error);}
  if(callbackErrors.length>1)throw new AggregateError(callbackErrors,'translation_callbacks_failed');
  if(callbackErrors.length)throw callbackErrors[0];
  if(signal.aborted)return {ok:false,stop:'aborted'};
  const after=await permitted(hooks,signal);
  if(after==='aborted')return {ok:false,stop:'aborted'};
  let error:unknown;
  if('reply' in response){
   try{return {ok:true,value:check(response.reply.text),permitted:after==='allowed'};}catch(failure){error=failure;}
  }else error=response.error;
  if(!(error instanceof ProviderError)&&!(error instanceof ReplyError))throw error;
  if(after==='permission')return {ok:false,stop:'permission'};
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
 if(!input||!first.permitted)return {kind:'done',results:first.value,reviewApplied:0,reviewDropped:0,reviewFailed:false};
 const review=await runPass(client,{instructions:reviewInstructions(job),input,effort:'medium'},text=>mergeReview(job,batch,first.value,text),hooks,signal);
 if(!review.ok){
  if(review.stop==='aborted')return {kind:'aborted'};
  return {kind:'done',results:first.value,reviewApplied:0,reviewDropped:0,reviewFailed:review.stop==='gave_up'};
 }
 return {kind:'done',results:review.value.results,reviewApplied:review.value.applied,reviewDropped:review.value.dropped,reviewFailed:false};
}
