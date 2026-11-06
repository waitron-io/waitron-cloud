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
}

export class SesFeedbackWorker {
 readonly #options:SesFeedbackWorkerOptions;
 constructor(options:SesFeedbackWorkerOptions){this.#options={...options};}

 async runOnce(signal:AbortSignal):Promise<boolean> {
  if(signal.aborted)return false;
  const {pool,config,recipientKeys,queue}=this.#options;
  let messages;
  try {
   messages=await queue.receive(signal);
   if(messages.length>1)throw Error();
  }catch{throw Error('ses_feedback_receive_failed');}
  if(signal.aborted||messages.length===0)return false;
  const message=messages[0]!;
  let event;
  try{event=parseSesFeedback(message.body,config);}
  catch{throw Error('ses_feedback_parse_failed');}
  let result;
  try{result=await applySesFeedback(pool,config,recipientKeys,event,sesFeedbackTransaction);}
  catch{throw Error('ses_feedback_processing_failed');}
  if(result==='conflict')throw Error('ses_feedback_conflict');
  // A lost acknowledgement replays committed evidence; it must never undo the commit.
  if(signal.aborted)return false;
  try{await queue.delete(message.receiptHandle,signal);}
  catch{throw Error('ses_feedback_acknowledgement_failed');}
  return true;
 }
}
