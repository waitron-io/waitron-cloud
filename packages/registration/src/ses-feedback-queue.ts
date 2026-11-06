import {SQSClient,ReceiveMessageCommand,DeleteMessageCommand,type SQSClientConfig} from '@aws-sdk/client-sqs';
import {isValidatedSesFeedbackConfig,type SesFeedbackConfig} from './ses-feedback-config.ts';

/** Only a trusted adapter bound to the configured queue may supply envelopes. */
export interface SesFeedbackQueue {
 receive(signal:AbortSignal):Promise<{body:string;receiptHandle:string}[]>;
 delete(receiptHandle:string,signal:AbortSignal):Promise<void>;
 close():void;
}

interface QueueOptions {
 credentials?:SQSClientConfig['credentials'];
 requestHandler?:SQSClientConfig['requestHandler'];
}

/** Transport injection supports local qualification; it cannot replace a queue binding. */
export function createSesFeedbackQueue(config:SesFeedbackConfig,options:QueueOptions={}):SesFeedbackQueue {
 if(!isValidatedSesFeedbackConfig(config))throw Error('ses_feedback_queue_configuration_failed');
 const client=new SQSClient({region:config.scope.region,
  endpoint:`https://sqs.${config.scope.region}.amazonaws.com`,ignoreConfiguredEndpointUrls:true,
  useQueueUrlAsEndpoint:false,maxAttempts:1,retryMode:'standard',credentials:options.credentials,
  requestHandler:options.requestHandler??{connectionTimeout:5000,requestTimeout:15000,throwOnRequestTimeout:true}});
 const closed=new AbortController();
 async function request<T>(signal:AbortSignal,diagnostic:string,send:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  const deadline=new AbortController(),combined=AbortSignal.any([signal,closed.signal,deadline.signal]);
  let timer:ReturnType<typeof setTimeout>|undefined,onAbort:()=>void=()=>{};
  try{
   if(combined.aborted)throw Error();
   const aborted=new Promise<never>((_resolve,reject)=>{
    onAbort=()=>reject(Error());combined.addEventListener('abort',onAbort,{once:true});
   });
   // The outer deadline also bounds a stalled credential provider or transport.
   timer=setTimeout(()=>deadline.abort(),15000);
   return await Promise.race([Promise.resolve().then(()=>send(combined)),aborted]);
  }catch{throw Error(diagnostic);}
  finally{clearTimeout(timer);combined.removeEventListener('abort',onAbort);}
 }
 return {
  async receive(signal){
   const diagnostic='ses_feedback_receive_failed';
   const response=await request(signal,diagnostic,current=>client.send(new ReceiveMessageCommand({
    QueueUrl:config.queueUrl,MaxNumberOfMessages:1,WaitTimeSeconds:10,VisibilityTimeout:60}),{abortSignal:current}));
   const messages=response.Messages??[];
   if(!Array.isArray(messages)||messages.length>1||messages.some(m=>typeof m.Body!=='string'||m.Body.length===0
    ||Buffer.byteLength(m.Body,'utf8')>262144||typeof m.ReceiptHandle!=='string'||m.ReceiptHandle.length===0||m.ReceiptHandle.length>4096))
    throw Error(diagnostic);
   return messages.map(m=>({body:m.Body!,receiptHandle:m.ReceiptHandle!}));
  },
  async delete(receiptHandle,signal){
   if(typeof receiptHandle!=='string'||receiptHandle.length===0||receiptHandle.length>4096)
    throw Error('ses_feedback_acknowledgement_failed');
   await request(signal,'ses_feedback_acknowledgement_failed',current=>client.send(
    new DeleteMessageCommand({QueueUrl:config.queueUrl,ReceiptHandle:receiptHandle}),{abortSignal:current}));
  },
  close(){if(!closed.signal.aborted){closed.abort();client.destroy();}},
 };
}
