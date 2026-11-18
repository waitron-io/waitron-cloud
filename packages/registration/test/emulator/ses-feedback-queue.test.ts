import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {IncomingMessage} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {stringify} from 'node:querystring';
import {test} from 'node:test';
import {checkServerIdentity} from 'node:tls';
import {
  CreateQueueCommand,GetQueueAttributesCommand,SendMessageCommand,SQSClient,
} from '@aws-sdk/client-sqs';
import {createSesFeedbackQueue} from '../../src/ses-feedback-queue.ts';
import {config} from '../fixtures/mail-attempt.ts';

const endpoint=process.env.AWS_EMULATOR_ENDPOINT;
const credentialsFile=process.env.AWS_EMULATOR_CREDENTIALS_FILE;
const skip=endpoint&&credentialsFile?false:
  'AWS Emulator is not running: set AWS_EMULATOR_ENDPOINT and AWS_EMULATOR_CREDENTIALS_FILE (Linux CI only; see .github/workflows/aws-emulator.yml)';

interface SignedRequest {
  method:string;
  path:string;
  query?:Record<string,string|string[]|null>;
  headers:Record<string,string>;
  body?:string|Uint8Array;
}

function forwardToEmulator(port:string) {
  return {
    async handle(request:SignedRequest,{abortSignal}:{abortSignal?:AbortSignal}={}) {
      const search=stringify(request.query);
      const response=await new Promise<IncomingMessage>((resolve,reject)=>{
        const outgoing=httpsRequest({
          host:'127.0.0.1',port,method:request.method,
          path:search?`${request.path}?${search}`:request.path,
          headers:request.headers,signal:abortSignal,
          // Keep the signed Host header and authenticate the local server by its loopback address.
          servername:'',checkServerIdentity:(_name,cert)=>checkServerIdentity('127.0.0.1',cert),
        },resolve);
        outgoing.on('error',reject);
        outgoing.end(request.body);
      });
      return {response:{statusCode:response.statusCode,headers:response.headers,body:response}};
    },
    destroy(){},
  };
}

test('emulator: the adapter receives a sent message, sees nothing while it is in flight, and deletes it',{skip},async t=>{
  assert.ok(endpoint&&credentialsFile);
  const url=new URL(endpoint);
  assert.ok(url.protocol==='https:'&&url.hostname==='127.0.0.1','SQS emulator must use loopback HTTPS');
  const contents=readFileSync(credentialsFile,'utf8');
  const accessKeyId=contents.match(/^aws_access_key_id\s*=\s*(\S+)\s*$/m)?.[1];
  const secretAccessKey=contents.match(/^aws_secret_access_key\s*=\s*(\S+)\s*$/m)?.[1];
  assert.ok(accessKeyId&&secretAccessKey,'AWS Emulator credentials are missing');
  const credentials={accessKeyId,secretAccessKey};

  const queueConfig=config('eu-north-1','ES','000000000000');
  const client=new SQSClient({
    region:'eu-north-1',endpoint,credentials,useQueueUrlAsEndpoint:false,
  });
  t.after(()=>client.destroy());
  const {QueueUrl}=await client.send(new CreateQueueCommand({QueueName:'mail-feedback'}));
  assert.ok(QueueUrl,'SQS did not return a queue URL');
  await client.send(new SendMessageCommand({QueueUrl,MessageBody:'synthetic envelope'}));

  const queue=createSesFeedbackQueue(queueConfig,{credentials,requestHandler:forwardToEmulator(url.port||'443')});
  try {
    const messages=await queue.receive(t.signal);
    const receiptHandle=messages[0]?.receiptHandle;
    assert.ok(receiptHandle);
    assert.deepEqual(messages,[{body:'synthetic envelope',receiptHandle}]);
    assert.deepEqual(await queue.receive(t.signal),[]);

    await queue.delete(receiptHandle,t.signal);
    const {Attributes}=await client.send(new GetQueueAttributesCommand({
      QueueUrl,AttributeNames:['ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible'],
    }));
    assert.equal(Attributes?.ApproximateNumberOfMessages,'0');
    assert.equal(Attributes?.ApproximateNumberOfMessagesNotVisible,'0');
  } finally {
    queue.close();
  }
});
