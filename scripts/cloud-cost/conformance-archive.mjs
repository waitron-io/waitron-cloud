import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';

export async function downloadConformanceArchive(url,digest,path,{signal,phase}) {
  const started=performance.now();let bytesReceived=0,status,attempt=1;
  const report=(event,details={})=>console.error('conformance_archive='+JSON.stringify({
    event,phase,url,elapsedMs:Math.round(performance.now()-started),timeoutMs:120000,
    attempt,bytesReceived,...(status===undefined?{}:{status}),...details}));
  report('start');
  // Connections, bodies and retry pauses share one budget so retries cannot extend setup.
  const downloadSignal=AbortSignal.any([signal,AbortSignal.timeout(120000)]);
  const progress=setInterval(()=>report('progress'),10000);
  try {
    for(;;attempt++) {
      bytesReceived=0;status=undefined;report('attempt');
      downloadSignal.throwIfAborted();
      let bytes,retryable=false;
      try {
        const response=await fetch(url,{signal:downloadSignal});
        status=response.status;report('headers');
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
