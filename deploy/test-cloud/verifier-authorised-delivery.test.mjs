import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),image=process.env.TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE;

// Restoring a local original instead of the independently delivered bytes must fail this contract.
for(const mode of ['valid','changed-archive','wrong-key','wrong-digest'])test('authorised private archive delivery: '+mode,{skip:!image,timeout:120000},async t=>{
 const source=fileURLToPath(new URL('test-fixtures/snapshot-authorised-archive.test.ts',import.meta.url)),exchange='/tmp/cloud-authorised-exchange',recoveryKey='delivery-'+randomUUID();
 const docker=async args=>{
  try{return(await execute('docker',args,{timeout:100000,maxBuffer:8*1024*1024})).stdout.trim();}
  catch(error){throw Object.assign(Error('private fixture Docker operation failed'),{code:error.code,assertionFailed:/AssertionError/.test(error.stdout+error.stderr),successPrinted:(error.stdout+error.stderr).includes('CLOUD_AUTHORISED_ARCHIVE=')});}
 };
 const id=await docker(['create','--network','none','--memory','4096m','--memory-swap','4096m','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128',
  '--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777','--tmpfs','/waitron/apps/server/node_modules/.vite-temp:rw,nosuid,nodev,size=16m,mode=1777','--tmpfs','/waitron/apps/server/node_modules/.vite:rw,nosuid,nodev,size=32m,mode=1777',
  '--env','CLOUD_AUTHORISED_EXCHANGE='+exchange,'--mount',`type=bind,src=${source},dst=/waitron/apps/server/src/cloud-authorised-archive.test.ts,readonly`,'--workdir','/waitron/apps/server','--entrypoint','node',image,'-e','setInterval(()=>{},1000)']);
 let running;
 t.after(async()=>{await docker(['rm','-f','-v',id]);if(running)await running;await assert.rejects(execute('docker',['inspect',id]),error=>error.code===1&&error.stderr.toLowerCase().includes('no such object: '+id));});
 await docker(['start',id]);
 const input=JSON.stringify({recoveryKey});
 // Only this disposable tmpfs sees the archive key. No key enters command arguments or logs.
 const {spawn}=await import('node:child_process');
 const send=async(name,value)=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',id,'node','--input-type=module','-e',`import {mkdir,writeFile,rename} from 'node:fs/promises';await mkdir('${exchange}',{recursive:true,mode:0o700});let s='';for await(const b of process.stdin)s+=b;await writeFile('${exchange}/${name}.pending',s,{mode:0o600});await rename('${exchange}/${name}.pending','${exchange}/${name}');`],{stdio:['pipe','ignore','pipe']});
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('private fixture write failed')));child.stdin.end(typeof value==='string'?value:JSON.stringify(value));
 });
 await send('input.json',input);
 let ended=false;
 running=docker(['exec',id,'pnpm','exec','vitest','run','src/cloud-authorised-archive.test.ts','--maxWorkers=1']).then(output=>({output}),error=>({error})).finally(()=>{ended=true;});
 let capture;
 for(let n=0;n<100;n++){
  capture=JSON.parse(await docker(['exec',id,'node','--input-type=module','-e',`import {readFile} from 'node:fs/promises';console.log(await readFile('${exchange}/capture.json','utf8').catch(e=>{if(e.code==='ENOENT')return 'null';throw e;}));`]));
  if(capture||ended)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert(capture,'authorised fixture must expose its newly captured archive through private exchange');
 const archive=Buffer.from(capture.archive,'base64'),digest=createHash('sha256').update(archive).digest('hex');
 assert(archive.length>0);assert.equal(capture.metadata.sourceNodeId,'a0000000-0000-4000-8000-000000000008');
 const delivered=Buffer.from(archive);if(mode==='changed-archive')delivered[delivered.length-1]^=1;
 await send('delivered.json',{archive:delivered.toString('base64'),recoveryKey:mode==='wrong-key'?'wrong key':recoveryKey,digest:mode==='wrong-digest'?'0'.repeat(64):createHash('sha256').update(delivered).digest('hex')});
 const result=await running;
 if(mode!=='valid'){assert(result.error,'changed delivery must refuse before ordinary restore');assert.equal(result.error.code,1);assert.equal(result.error.assertionFailed,true);assert.equal(result.error.successPrinted,false);return;}
 assert.equal(result.error,undefined);
 assert(!result.output.includes(recoveryKey));assert(!result.output.includes(capture.archive));
 const matches=[...result.output.matchAll(/^.*CLOUD_AUTHORISED_ARCHIVE=(\{[^\n]+)$/gm)];assert.equal(matches.length,1);
 const restored=JSON.parse(matches[0][1]);
 assert.deepEqual(restored.delivery,{sha256:digest,bytes:archive.length,source:'private-delivery',matchedCapture:true});
 assert.deepEqual(restored.ordinaryRestore,{exit:0,preparationBoundToRecapture:true,retiredCounters:[123,123,123],activeCounters:[1,1,1],allocations:2});
});
