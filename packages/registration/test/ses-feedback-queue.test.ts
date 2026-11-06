import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {config} from './fixtures/mail-attempt.ts';

async function factory() {
 const module=await import('../src/ses-feedback-queue.ts');
 assert.equal(typeof module.createSesFeedbackQueue,'function','The authenticated SQS transport is missing');
 return module.createSesFeedbackQueue;
}
const credentials={accessKeyId:'LOCALACCESS',secretAccessKey:'local-secret',sessionToken:'local-token'};
interface Request {hostname:string;protocol:string;headers:Record<string,string>;body:string|Uint8Array;}
const requestBody=(request:Request)=>JSON.parse(typeof request.body==='string'?request.body:new TextDecoder().decode(request.body));
function message(body:string|undefined,receiptHandle:string|undefined){
 return {Body:body,ReceiptHandle:receiptHandle,MessageId:'synthetic',MD5OfBody:createHash('md5').update(body??'').digest('hex')};
}
function transport(responses:unknown[]) {
 const requests:Request[]=[];let destroyed=0;
 return {requests,get destroyed(){return destroyed;},
  handle:async(request:Request)=>{
   requests.push(request);
   return {response:{statusCode:200,headers:{'content-type':'application/x-amz-json-1.0'},
    body:Readable.from([JSON.stringify(responses.shift()??{})])}};
  },destroy(){destroyed++;}};
}

test('SQS intake signs requests for the immutable region and queue with one-message operational budgets',async()=>{
 const create=await factory(),wire=transport([{Messages:[{Body:'opaque envelope',ReceiptHandle:'private-handle',MessageId:'message-id',MD5OfBody:'5fc7cbdb3ce481406eb9fe751c8ffda6'}]},{}]);
 const q=create(config(),{credentials,requestHandler:wire});
 try{
  const signal=new AbortController().signal;
  assert.deepEqual(await q.receive(signal),[{body:'opaque envelope',receiptHandle:'private-handle'}]);
  await q.delete('private-handle',signal);
  assert.equal(wire.requests.length,2);
  for(const request of wire.requests){
   assert.equal(request.hostname,'sqs.eu-north-1.amazonaws.com');assert.equal(request.protocol,'https:');
   assert.match(request.headers.authorization!,/^AWS4-HMAC-SHA256 Credential=LOCALACCESS\/\d{8}\/eu-north-1\/sqs\/aws4_request,/);
   assert.equal(request.headers['x-amz-security-token'],'local-token');
  }
  assert.deepEqual(requestBody(wire.requests[0]!),{
   QueueUrl:'https://sqs.eu-north-1.amazonaws.com/123456789012/mail-feedback',MaxNumberOfMessages:1,WaitTimeSeconds:10,VisibilityTimeout:60});
  assert.deepEqual(requestBody(wire.requests[1]!),{
   QueueUrl:'https://sqs.eu-north-1.amazonaws.com/123456789012/mail-feedback',ReceiptHandle:'private-handle'});
  assert.equal(wire.requests[0]!.headers['x-amz-target'],'AmazonSQS.ReceiveMessage');
  assert.equal(wire.requests[1]!.headers['x-amz-target'],'AmazonSQS.DeleteMessage');
 }finally{q.close();}
 assert.equal(wire.destroyed,1);
});

test('Paris configuration signs only for Paris and cannot be replaced by an unvalidated clone',async()=>{
 const create=await factory(),wire=transport([{}]),trusted=config('eu-west-3');
 assert.throws(()=>create({...trusted},{credentials,requestHandler:wire}),/^Error: ses_feedback_queue_configuration_failed$/);
 const q=create(trusted,{credentials,requestHandler:wire});
 try{
  assert.deepEqual(await q.receive(new AbortController().signal),[]);
  assert.equal(wire.requests[0]!.hostname,'sqs.eu-west-3.amazonaws.com');
  assert.match(wire.requests[0]!.headers.authorization!,/\/eu-west-3\/sqs\/aws4_request,/);
  assert.equal(requestBody(wire.requests[0]!).QueueUrl,'https://sqs.eu-west-3.amazonaws.com/123456789012/mail-feedback');
 }finally{q.close();}
});

test('malformed SQS replies never supply partial or oversized work to the consumer',async()=>{
 const create=await factory();
 for(const response of [{Messages:[message('one','a'),message('two','b')]},
  {Messages:[message('one',undefined)]},{Messages:[message(undefined,'a')]},
  {Messages:[message('','a')]},{Messages:[message('one','')]},
  {Messages:[message('one','x'.repeat(4097))]},{Messages:[message('x'.repeat(262145),'a')]},
  {Messages:[message('é'.repeat(131073),'a')]}]){
  const wire=transport([response]),q=create(config(),{credentials,requestHandler:wire});
  try{await assert.rejects(q.receive(new AbortController().signal),/^Error: ses_feedback_receive_failed$/);}
  finally{q.close();}
  assert.equal(wire.requests.length,1);
 }
});

test('endpoint environment settings cannot redirect a validated queue',async()=>{
 const create=await factory(),wire=transport([{}]);
 const old=process.env.AWS_ENDPOINT_URL_SQS;process.env.AWS_ENDPOINT_URL_SQS='http://untrusted.invalid';
 const q=create(config(),{credentials,requestHandler:wire});
 try{
  await q.receive(new AbortController().signal);
  assert.equal(wire.requests[0]!.hostname,'sqs.eu-north-1.amazonaws.com');
  assert.equal(wire.requests[0]!.protocol,'https:');
 }finally{q.close();if(old===undefined)delete process.env.AWS_ENDPOINT_URL_SQS;else process.env.AWS_ENDPOINT_URL_SQS=old;}
});

test('pre-abort and close prevent receive and delete from reaching the transport',async()=>{
 const create=await factory(),wire=transport([]),q=create(config(),{credentials,requestHandler:wire});
 const stop=new AbortController();stop.abort();
 await assert.rejects(q.receive(stop.signal),/^Error: ses_feedback_receive_failed$/);
 await assert.rejects(q.delete('private-handle',stop.signal),/^Error: ses_feedback_acknowledgement_failed$/);
 q.close();q.close();
 await assert.rejects(q.receive(new AbortController().signal),/^Error: ses_feedback_receive_failed$/);
 await assert.rejects(q.delete('private-handle',new AbortController().signal),/^Error: ses_feedback_acknowledgement_failed$/);
 assert.equal(wire.requests.length,0);assert.equal(wire.destroyed,1);
});

test('an in-flight abort bounds an uncooperative transport and never exposes its error',async()=>{
 const create=await factory();let entered!:()=>void,observed:AbortSignal|undefined;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const wire={handle:async(_request:unknown,options:{abortSignal?:AbortSignal})=>{
  observed=options.abortSignal;entered();return new Promise<never>(()=>{});
 },destroy(){}};
 const q=create(config(),{credentials,requestHandler:wire}),stop=new AbortController();
 try{
  const receiving=q.receive(stop.signal);await started;stop.abort(Error('private response body'));
  await assert.rejects(Promise.race([receiving,delay(1000).then(()=>{throw Error('receive did not stop');})]),/^Error: ses_feedback_receive_failed$/);
  assert.equal(observed?.aborted,true);
 }finally{q.close();}
});

test('the fifteen-second request deadline aborts stalled receive and delete without retries',async t=>{
 const create=await factory();
 for(const operation of ['receive','delete'] as const){
  let entered!:()=>void,observed:AbortSignal|undefined;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  let calls=0;
  const wire={handle:async(_request:unknown,options:{abortSignal?:AbortSignal})=>{
   calls++;observed=options.abortSignal;entered();return new Promise<never>(()=>{});
  },destroy(){}};
  const q=create(config(),{credentials,requestHandler:wire});
  t.mock.timers.enable({apis:['setTimeout']});
  try{
   const result=operation==='receive'?q.receive(new AbortController().signal):q.delete('private-handle',new AbortController().signal);
   void result.catch(()=>{});
   await started;t.mock.timers.tick(15000);
   assert.equal(observed?.aborted,true,'the deadline must abort the actual request');
   await assert.rejects(result,operation==='receive'?/^Error: ses_feedback_receive_failed$/:/^Error: ses_feedback_acknowledgement_failed$/);
   assert.equal(observed?.aborted,true);assert.equal(calls,1);
  }finally{t.mock.timers.reset();q.close();}
 }
});

test('service failures use one request and fixed diagnostics without response or handle leakage',async()=>{
 const create=await factory();let calls=0;
 const wire={handle:async()=>{calls++;return {response:{statusCode:500,headers:{},
  body:Readable.from([JSON.stringify({__type:'InternalError',message:'private token and response'})])}};},destroy(){}};
 const q=create(config(),{credentials,requestHandler:wire});
 try{
  await assert.rejects(q.receive(new AbortController().signal),/^Error: ses_feedback_receive_failed$/);
  await assert.rejects(q.delete('private-handle',new AbortController().signal),/^Error: ses_feedback_acknowledgement_failed$/);
  assert.equal(calls,2);
 }finally{q.close();}
});

test('malformed handles cannot create a delete request',async()=>{
 const create=await factory(),wire=transport([]),q=create(config(),{credentials,requestHandler:wire});
 try{
  for(const handle of ['','x'.repeat(4097)])await assert.rejects(q.delete(handle,new AbortController().signal),/^Error: ses_feedback_acknowledgement_failed$/);
  assert.equal(wire.requests.length,0);
 }finally{q.close();}
});

test('close cancels an active delete',async()=>{
 const create=await factory();let entered!:()=>void,observed:AbortSignal|undefined;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 let calls=0,destroyed=0;
 const wire={handle:async(_request:unknown,options:{abortSignal?:AbortSignal})=>{
  calls++;observed=options.abortSignal;entered();return new Promise<never>(()=>{});
 },destroy(){destroyed++;}};
 const q=create(config(),{credentials,requestHandler:wire});
 try{
  const deleting=q.delete('private-handle',new AbortController().signal);void deleting.catch(()=>{});await started;q.close();
  assert.equal(observed?.aborted,true,'close must abort the actual request');
  await assert.rejects(deleting,/^Error: ses_feedback_acknowledgement_failed$/);
  assert.equal(observed?.aborted,true);assert.equal(calls,1);assert.equal(destroyed,1);
 }finally{q.close();}
});

test('a stalled credential provider shares the request deadline and cannot send after close',async t=>{
 const create=await factory(),wire=transport([]);let entered!:()=>void,release!:(value:typeof credentials)=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const q=create(config(),{credentials:async()=>{entered();return new Promise(resolve=>{release=resolve;});},requestHandler:wire});
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const receiving=q.receive(new AbortController().signal);let settled=false;
  void receiving.then(()=>{settled=true;},()=>{settled=true;});
  await started;t.mock.timers.tick(15000);
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(settled,true,'the deadline must also bound credentials');
  await assert.rejects(receiving,/^Error: ses_feedback_receive_failed$/);q.close();
  release(credentials);await Promise.resolve();
  assert.equal(wire.requests.length,0);
 }finally{t.mock.timers.reset();q.close();}
});
