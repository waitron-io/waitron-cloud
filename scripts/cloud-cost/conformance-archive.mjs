import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

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
  // Connections, bodies and retry pauses share one budget so retries cannot extend setup.
  const downloadSignal=AbortSignal.any([signal,AbortSignal.timeout(120000)]);
  const progress=setInterval(()=>report('progress'),10000);
  try {
    for(;;attempt++) {
      bytesReceived=0;status=undefined;identity={};report('attempt');
      downloadSignal.throwIfAborted();
      let bytes,retryable=false;
      try {
        const response=await fetch(url,{signal:downloadSignal});
        status=response.status;identity=responseIdentity(response);report('headers');
        if(!response.ok){
          retryable=status>=500&&status<=599;
          await response.body?.cancel();
          throw Error('Fixture archive download failed');
        }
        const chunks=[];
        for await(const chunk of response.body){chunks.push(chunk);bytesReceived+=chunk.length;}
        bytes=Buffer.concat(chunks);
      } catch(error) {
        downloadSignal.throwIfAborted();
        const reset=['ECONNRESET','UND_ERR_SOCKET'].includes(error?.cause?.code??error?.code);
        if(attempt>=3||(!retryable&&!reset))throw error;
        const pauseMs=attempt*1000;
        report('retry',{pauseMs,errorName:error?.name??'UnknownError',errorCode:error?.cause?.code??error?.code});
        try {await delay(pauseMs,undefined,{signal:downloadSignal});}
        catch(error) {downloadSignal.throwIfAborted();throw error;}
        continue;
      }
      downloadSignal.throwIfAborted();
      if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Fixture archive digest mismatch');
      writeFileSync(path,bytes);
      report('complete');return;
    }
  } catch(error) {report('failure',{errorName:error?.name??'UnknownError',errorCode:error?.cause?.code??error?.code});throw error;}
  finally {clearInterval(progress);}
}
