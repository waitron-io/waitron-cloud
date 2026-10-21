import {createWriteStream} from 'node:fs';
import {lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readVerificationInput} from './verification-transport.ts';
import {readBackupVerificationResult} from './verification-protocol.ts';
const watchdog=setTimeout(()=>process.exit(74),30000);
try{
 const [dist,scratchRoot]=process.argv.slice(2);
 const {request,key,archive}=await readVerificationInput(process.stdin);
 const bundle=await import(pathToFileURL(join(dist,'backup-verification.js')).href);
 const target=bundle.currentBackupVerificationTarget();
 if(!isDeepStrictEqual(target,request.target))throw Error('backup.verifier_configuration');
 const migrationsRoot=join(dist,'drizzle');
 // Fail closed on incomplete compiled assets before asking module owners to verify anything.
 async function journals(directory){
  let count=0;
  for(const name of await readdir(directory)){
   const path=join(directory,name),info=await lstat(path);
   if(info.isSymbolicLink())throw Error('backup.verifier_configuration');
   if(info.isDirectory())count+=await journals(path);
   else if(name==='_journal.json')count++;
  }
  return count;
 }
 if(!await journals(migrationsRoot))throw Error('backup.verifier_configuration');
 const artifactPath=join(scratchRoot,'input.backup.enc');let bytes=0;
 const meter=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;done(bytes>256*1024*1024?Error('backup.verifier_resource'):null,chunk);}});
 await pipeline(Readable.from(archive),meter,createWriteStream(artifactPath,{flags:'wx',mode:0o600}));
 const result=await bundle.verifyBackupArtifact(request,{artifactPath,recoveryKey:key,scratchRoot,modules:bundle.BACKUP_VERIFICATION_MODULES,migrationsRoot,runtime:target.runtime,signal:new AbortController().signal,now:()=>new Date()});
 process.stdout.write(JSON.stringify(readBackupVerificationResult(JSON.stringify(result),request)));
}catch(error){
 process.exitCode=error.code==='ENOSPC'||error.message==='backup.verifier_resource'?73:1;
 console.error(process.exitCode===73?'backup.verifier_resource':'backup.verifier_failed');
}finally{clearTimeout(watchdog);}
