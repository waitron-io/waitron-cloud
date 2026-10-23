// Faults use the same captured bytes and immutable candidate in fresh, privately owned children.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {bufferObject} from '../../../packages/backups/src/object-transfer.ts';
import {backupVerificationRequestDigest} from '../../../packages/backups/src/verification-protocol.ts';
import {createBoundContainerWaitronVerifier} from '../../../packages/backups/src/bound-container-verifier.ts';
import {openVerifierController} from '../verifier-controller.mjs';
const execute=promisify(execFile);
const errors={'malformed-output':'backup.verifier_output',timeout:'backup.verifier_timeout',scratch:'backup.verifier_resource',cancel:'backup.verifier_cancelled',crash:'backup.verifier_container','uncertain-cleanup':'backup.verifier_cleanup'};
export async function snapshotVerifierControls({directory,image,owner,runId,request,archive,recoveryKey}){
 const bytes=Buffer.from(archive,'base64'),source=bufferObject(bytes);
 assert.equal(source.receipt.digest,request.archive.sha256);assert.equal(source.receipt.size,request.archive.bytes);
 const controller=await openVerifierController({directory,owner,image}),cases=[];let pending;
 const docker=async args=>{try{return(await execute('docker',args,{timeout:15000,maxBuffer:65536})).stdout.trim();}catch{throw Error('fixture.verifier_control_docker');}};
 const absent=async id=>{
  await assert.rejects(execute('docker',['inspect',id],{timeout:10000,maxBuffer:65536}),error=>error.code===1&&!error.signal&&!error.killed&&error.stderr.trim().toLowerCase()==='error: no such object: '+id,'exact control child must be absent');
 };
 try{
  for(const name of ['wrong-key','archive-integrity','malformed-output','timeout','scratch','cancel','crash','uncertain-cleanup','later-valid']){
   console.error('snapshot-control:'+name);
   const bound={...structuredClone(request),attempt:{...request.attempt,claimId:'control-'+randomUUID(),controllerScope:controller.scope,childToken:randomUUID(),deadline:new Date(Date.now()+(name==='timeout'?8000:30000)).toISOString()}},stop=new AbortController();
   let childId,opened=false,faultObserved=false,action=Promise.resolve(),output,error;
   const managed={...controller,async create(args,supplied){childId=await controller.create(args,supplied);pending={id:childId,request:supplied};return childId;},async remove(id,supplied){
    if(name==='uncertain-cleanup'){assert.equal(JSON.parse(await docker(['inspect',id]))[0].State.Status,'exited');faultObserved=true;return;}
    await controller.remove(id,supplied);pending=null;
   }};
   const verify=await createBoundContainerWaitronVerifier({image,owner,controller:managed});
   const damaged=Buffer.from(bytes);if(name==='archive-integrity'){damaged[damaged.length-1]^=1;faultObserved=true;}
   const key={version:bound.backupKey.version,reference:bound.backupKey.reference,secret:name==='wrong-key'?randomBytes(32).toString('base64url'):recoveryKey};
   if(name==='wrong-key'){assert.notEqual(key.secret,recoveryKey);faultObserved=true;}
   const input={...source,open(){
    opened=true;
    if(['timeout','cancel','crash'].includes(name)){
     const stalled=new Readable({read(){}});faultObserved=true;
     if(name==='cancel')queueMicrotask(()=>stop.abort());
     if(name==='crash')action=docker(['kill','--signal','KILL',childId]);
     return stalled;
    }
    return Readable.from((async function*(){
     if(name==='malformed-output'){
      await docker(['exec',childId,'node','-e',"require('node:fs').writeFileSync('/proc/1/fd/1','{deliberately-invalid-output}\\n')"]);faultObserved=true;
     }
     if(name==='scratch'){
      const filled=await docker(['exec',childId,'node','-e',"const f=require('node:fs'),fd=f.openSync('/scratch/control-quota','wx',0o600),chunk=Buffer.alloc(1024*1024,1);try{for(;;)f.writeSync(fd,chunk);}catch(e){if(e.code!=='ENOSPC')throw e;process.stdout.write(e.code);}finally{f.closeSync(fd)}"]);
      assert.equal(filled,'ENOSPC');faultObserved=true;
     }
     yield damaged;
    })());
   }};
   try{output=await verify(input,key,bound,stop.signal);}catch(failure){error=failure.message;}
   await action;
   assert(opened,'control must enter a running exact child');assert.match(childId,/^[a-f0-9]{64}$/);
   if(name in errors){assert.equal(error,errors[name],name);assert.equal(output,undefined,'a refused child cannot publish a verdict');}
   else{
    assert.equal(error,undefined,name);assert.equal(output.result.activation,'not_attempted');
    const [status,reason]=name==='wrong-key'?['unavailable','decryption_unavailable']:name==='archive-integrity'?['invalid','archive_digest_mismatch']:['passed','none'];
    assert.equal(output.result.status,status,name);assert.equal(output.result.reason,reason,name);
    if(name==='later-valid'){assert.equal(output.result.modules.length,request.target.modules.length);assert(output.result.modules.every(m=>m.status==='passed'&&m.checks.length));faultObserved=true;}
   }
   if(name==='uncertain-cleanup')await controller.remove(childId,bound);
   await absent(childId);pending=null;
   assert.equal(await docker(['ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner='+owner,'--filter','label=cloud.backup-verifier.scope='+controller.scope]),'');
   assert(faultObserved,'control must observe its intended fault or recovery');
   cases.push({name,request:bound,result:output?.result??null,receipt:output?.receipt??null,error:error??null,childId,terminated:true,cleanupConfirmed:true,faultObserved});
  }
 }finally{if(pending)await controller.remove(pending.id,pending.request);}
 return{runId,sourceRequestDigest:backupVerificationRequestDigest(request),archiveSha256:source.receipt.digest,archiveBytes:source.receipt.size,candidateImage:image,cases};
}
