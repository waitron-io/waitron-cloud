import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createSesFeedbackQueue as create} from '../../src/ses-feedback-queue.ts';

export function createSesFeedbackQueue(config){
 let delivered=false,receives=0,clock=0,visible=0,redriven=false;
 const mode=process.env.LOCAL_FEEDBACK_MODE;
 if(mode==='idle-leak')setInterval(()=>{},1000);
 const body=process.env.LOCAL_FEEDBACK_BODY;
 function sample(deadLetterCount){
  writeFileSync(process.env.CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE,JSON.stringify({observedAt:Date.now(),
   queueAgeSeconds:0,deadLetterCount,configurationRevision:config.revision,configurationDrift:false}));
 }
 sample(0);
 return create(config,{credentials:{accessKeyId:'LOCALACCESS',secretAccessKey:'local-secret'},requestHandler:{
  async handle(request,{abortSignal}={}){
   const target=request.headers['x-amz-target'];let response={};
   if(target==='AmazonSQS.ReceiveMessage'){
    process.send?.({stage:'receive'});
    if(mode==='poison'){
     clock+=30;
     if(!redriven&&clock>=visible){
      if(receives===5){redriven=true;sample(1);process.send?.({stage:'redriven',receives});}
      else{receives++;visible=clock+60;response={Messages:[{Body:'private invalid envelope',ReceiptHandle:`private-${receives}`,
       MessageId:'synthetic',MD5OfBody:createHash('md5').update('private invalid envelope').digest('hex')}]};}
     }
    }else if(!mode.startsWith('idle')&&!delivered){
     delivered=true;response={Messages:[{Body:body,ReceiptHandle:'private-handle',MessageId:'synthetic',MD5OfBody:createHash('md5').update(body).digest('hex')}]};
    }else if(mode!=='replay')await new Promise((_resolve,reject)=>{
     if(abortSignal?.aborted)reject(Error('private cancelled transport'));
     else abortSignal?.addEventListener('abort',()=>reject(Error('private cancelled transport')),{once:true});
    });
   }else if(target==='AmazonSQS.DeleteMessage'){
    process.send?.({stage:'delete'});
    if(mode==='crash')await new Promise(()=>{});
   }else throw Error('local fixture refuses every other SQS action');
   return {response:{statusCode:200,headers:{'content-type':'application/x-amz-json-1.0'},body:Readable.from([JSON.stringify(response)])}};
  },destroy(){},
 }});
}
