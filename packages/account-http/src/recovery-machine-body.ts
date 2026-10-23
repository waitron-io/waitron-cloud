import {readRecoveryMachineEnvelope} from '@waitron-cloud/backups/recovery';
import {AccountHttpError} from './errors.ts';
/** Only the machine recovery route carries a complete target; owner forms keep their smaller bound. */
export async function readRecoveryMachineBody(request:Request,withId:boolean){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')
  ||(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity'))throw new AccountHttpError(415,'invalid_input');
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>65536))throw new AccountHttpError(413,'invalid_input');
 if(request.signal.aborted)throw new AccountHttpError(408,'invalid_input');
 const reader=request.body?.getReader();let timer:ReturnType<typeof setTimeout>|undefined;let onAbort=()=>{};
 try{
  const cancelled=new Promise<never>((_,reject)=>{onAbort=()=>reject(new AccountHttpError(408,'invalid_input'));request.signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(onAbort,5000);});
  const chunks:Uint8Array[]=[];let size=0;
  if(reader)for(;;){const {done,value}=await Promise.race([reader.read(),cancelled]);if(done)break;size+=value.byteLength;if(size>65536)throw new AccountHttpError(413,'invalid_input');chunks.push(value);}
  try{return readRecoveryMachineEnvelope(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)),withId);}
  catch{throw new AccountHttpError(400,'invalid_input');}
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',onAbort);if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
}
