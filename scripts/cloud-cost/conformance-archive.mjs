import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';

export async function downloadConformanceArchive(url,digest,path,{signal,phase}) {
  const started=performance.now();let bytesReceived=0,status;
  const report=(event,details={})=>console.error('conformance_archive='+JSON.stringify({
    event,phase,url,elapsedMs:Math.round(performance.now()-started),timeoutMs:120000,
    bytesReceived,...(status===undefined?{}:{status}),...details}));
  report('start');
  // Report a stalled connection as well as a stalled body without extending its budget.
  const progress=setInterval(()=>report('progress'),10000);
  try {
    const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
    status=response.status;report('headers');
    if(!response.ok)throw Error('Fixture archive download failed');
    const chunks=[];
    for await(const chunk of response.body){chunks.push(chunk);bytesReceived+=chunk.length;}
    const bytes=Buffer.concat(chunks);
    signal.throwIfAborted();
    if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('Fixture archive digest mismatch');
    writeFileSync(path,bytes);
    report('complete');
  } catch(error) {report('failure',{errorName:error?.name??'UnknownError'});throw error;}
  finally {clearInterval(progress);}
}
