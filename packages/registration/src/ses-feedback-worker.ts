import type {Pool} from 'pg';
import type {SesFeedbackConfig} from './ses-feedback-config.ts';
import type {RelayKeyConfig} from './relay-payload.ts';
import type {SesFeedbackQueue} from './ses-feedback-queue.ts';
import {parseSesFeedback} from './ses-feedback-event.ts';
import {applySesFeedback} from './ses-feedback-store.ts';
import {sesFeedbackTransaction} from './ses-feedback-transaction.ts';

interface SesFeedbackWorkerOptions {
 pool:Pool;
 config:SesFeedbackConfig;
 recipientKeys:RelayKeyConfig;
 queue:SesFeedbackQueue;
 now?:()=>number;
}

type Failure='ses_feedback_receive_failed'|'ses_feedback_parse_failed'|'ses_feedback_processing_failed'
 |'ses_feedback_conflict'|'ses_feedback_acknowledgement_failed';
type Phase='receiving'|'processing'|'acknowledging';
interface Consumer {
 phase:Phase|null;since:number;poll:number|null;commit:number|null;failure:Failure|null;signal:AbortSignal|null;
}
interface OperationalSample {
 observedAt:number;queueAgeSeconds:number;deadLetterCount:number;configurationRevision:string;configurationDrift:boolean;
}

export class SesFeedbackWorker {
 readonly #options:SesFeedbackWorkerOptions;
 readonly #consumers:Consumer[]=Array.from({length:2},()=>({phase:null,since:0,poll:null,commit:null,failure:null,signal:null}));
 #next=0;
 constructor(options:SesFeedbackWorkerOptions){this.#options={...options};}
 #now(){return (this.#options.now??Date.now)();}

 /** Samples come from a trusted operational collector, never from an envelope. */
 status(input:unknown) {
  const now=this.#now(),revision=this.#options.config.revision;
  const age=(at:number|null)=>at===null?null:now-at;
  const fresh=(at:number|null,limit:number)=>at!==null&&Number.isFinite(now)&&Number.isFinite(at)&&now-at>=0&&now-at<limit;
  const natural=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
  let sample:OperationalSample|null=null;
  if(input!==null&&typeof input==='object') {
   // Copy only data properties so a malformed collector cannot run accessors.
   const fields=Object.getOwnPropertyDescriptors(input);
   const value=(key:string)=>fields[key]?.value;
   if(typeof value('observedAt')==='number'&&Number.isFinite(value('observedAt'))
    &&natural(value('queueAgeSeconds'))&&natural(value('deadLetterCount'))
    &&typeof value('configurationRevision')==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value('configurationRevision'))
    &&typeof value('configurationDrift')==='boolean')sample={observedAt:value('observedAt'),
     queueAgeSeconds:value('queueAgeSeconds'),deadLetterCount:value('deadLetterCount'),
     configurationRevision:value('configurationRevision'),configurationDrift:value('configurationDrift')};
  }
  const failure=this.#consumers.find(c=>c.failure!==null)?.failure??null;
  // Freshness is one maximum request/transaction/request cycle, not an alert threshold.
  const stale=!sample||!fresh(sample.observedAt,35000)||this.#consumers.some(c=>
   (c.poll!==null&&!fresh(c.poll,35000))||(c.phase!==null&&!fresh(c.since,c.phase==='processing'?5000:15000)));
  const stopped=this.#consumers.some(c=>c.signal?.aborted);
  const starting=this.#consumers.some(c=>c.poll===null);
  const drift=sample&&(sample.configurationDrift||sample.configurationRevision!==revision);
  const state=stopped?'stopped':failure?'failed':stale?'stale':drift?'drift':starting?'starting':'ready';
  const polls=this.#consumers.map(c=>age(c.poll)),commits=this.#consumers.flatMap(c=>c.commit===null?[]:[age(c.commit)!]);
  return {ready:state==='ready',state,failure,activeConsumers:this.#consumers.filter(c=>c.phase!==null).length,
   lastPollAgeMs:polls.some(p=>p===null)?null:Math.max(...polls as number[]),
   lastCommitAgeMs:commits.length?Math.min(...commits):null,
   queueAgeSeconds:sample?.queueAgeSeconds??null,deadLetterCount:sample?.deadLetterCount??null,configurationRevision:revision};
 }

 async runOnce(signal:AbortSignal):Promise<boolean> {
  if(signal.aborted)return false;
  const index=[this.#next,1-this.#next].find(i=>this.#consumers[i]!.phase===null);
  if(index===undefined)throw Error('ses_feedback_concurrency_failed');
  this.#next=1-index;
  const consumer=this.#consumers[index]!;consumer.signal=signal;
  this.#phase(consumer,'receiving');
  try{
   const result=await this.#runOnce(signal,consumer);consumer.failure=null;return result;
  }finally{consumer.phase=null;}
 }

 #phase(consumer:Consumer,phase:Phase){consumer.phase=phase;consumer.since=this.#now();}
 #fail(consumer:Consumer,failure:Failure):never{consumer.failure=failure;throw Error(failure);}

 async #runOnce(signal:AbortSignal,consumer:Consumer):Promise<boolean> {
  const {pool,config,recipientKeys,queue}=this.#options;
  let messages;
  try {
   messages=await queue.receive(signal);
   if(messages.length>1)throw Error();
  }catch{this.#fail(consumer,'ses_feedback_receive_failed');}
  consumer.poll=this.#now();
  if(signal.aborted||messages.length===0)return false;
  const message=messages[0]!;
  let event;
  try{event=parseSesFeedback(message.body,config);}
  catch{this.#fail(consumer,'ses_feedback_parse_failed');}
  this.#phase(consumer,'processing');
  let result;
  try{result=await applySesFeedback(pool,config,recipientKeys,event,sesFeedbackTransaction);}
  catch{this.#fail(consumer,'ses_feedback_processing_failed');}
  if(result==='conflict')this.#fail(consumer,'ses_feedback_conflict');
  consumer.commit=this.#now();
  // A lost acknowledgement replays committed evidence; it must never undo the commit.
  if(signal.aborted)return false;
  this.#phase(consumer,'acknowledging');
  try{await queue.delete(message.receiptHandle,signal);}
  catch{this.#fail(consumer,'ses_feedback_acknowledgement_failed');}
  return true;
 }
}
