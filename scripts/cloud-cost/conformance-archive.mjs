import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {downloadStorageArchive} from '../fixtures/storage-archive-download.mjs';

function responseIdentity(response) {
  const identity={};
  // Redirect URLs can carry signatures; retain only known public service labels.
  try {
    const service=new Map([
      ['github.com','github'],
      ['release-assets.githubusercontent.com','github-release-assets'],
      ['objects.githubusercontent.com','github-objects'],
    ]).get(new URL(response.url).hostname);
    if(service)identity.responseService=service;
  }catch{}
  for(const [header,key,accept] of [
    ['server','responseServer',value=>new Map([
      ['GitHub.com','github'],['github.com','github'],['Varnish','varnish'],
      ['Windows-Azure-Blob/1.0 Microsoft-HTTPAPI/2.0','azure-blob'],
    ]).get(value)],
    ['x-github-request-id','githubRequestId',value=>typeof value==='string'&&/^[a-f0-9]{1,16}(?::[a-f0-9]{1,16}){3,5}$/i.test(value)?value:undefined],
    ['x-ms-request-id','azureRequestId',value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)?value:undefined],
  ]) {
    try {const value=accept(response.headers.get(header));if(value)identity[key]=value;}catch{}
  }
  return identity;
}

export async function downloadConformanceArchive(url,digest,path,{signal,phase}) {
  const started=performance.now();let bytesReceived=0,status,attempt=1,identity={};
  const report=(event,details={})=>console.error('conformance_archive='+JSON.stringify({
    event,phase,url,elapsedMs:Math.round(performance.now()-started),timeoutMs:120000,
    attempt,bytesReceived,...(status===undefined?{}:{status}),...identity,...details}));
  report('start');
  const progress=setInterval(()=>report('progress'),10000);
  try {
    const callerSignal=AbortSignal.any([signal]);
    if(callerSignal.aborted){report('attempt');callerSignal.throwIfAborted();}
    const bytes=await downloadStorageArchive(url,{
      signal:callerSignal,attempts:3,timeoutMs:120000,inactivityMs:30000,
      inactivityReason:new DOMException('Fixture archive download stalled','ArchiveInactivityError'),
      // A reset while discarding a refusal body retains the conformance retry policy.
      retryStatusErrors:true,
      report(record){
        attempt=record.attempt;bytesReceived=record.bytesReceived;status=record.status??undefined;
        if(record.event==='attempt'){identity={};report('attempt');}
        if(record.event==='retry')report('retry',{pauseMs:attempt*1000,
          errorName:record.error?.name??'UnknownError',errorCode:record.error?.cause?.code??record.error?.code});
      },
      async validate(response){
        identity=responseIdentity(response);report('headers');
        if(!response.ok){
          await response.body?.cancel();
          throw Error('Fixture archive download failed');
        }
      },
      async consume(response,progressReceived){
        const chunks=[];
        for await(const chunk of response.body){chunks.push(chunk);bytesReceived+=chunk.length;progressReceived(chunk.length);}
        return Buffer.concat(chunks);
      },
    });
    if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Fixture archive digest mismatch');
    writeFileSync(path,bytes);
    report('complete');
  } catch(error) {report('failure',{errorName:error?.name??'UnknownError',errorCode:error?.cause?.code??error?.code});throw error;}
  finally {clearInterval(progress);}
}
