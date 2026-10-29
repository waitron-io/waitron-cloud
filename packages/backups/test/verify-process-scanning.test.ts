import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {test} from 'node:test';
import {runNodeVerifier} from '../src/verify-process.ts';

for(const pauseParent of [false,true]){
 const suffix=pauseParent?' after parent spawn pause':'';

test('one-byte stderr delivery scans bounded text per byte and preserves valid output'+suffix,async t=>{
 const spawn=childProcess.spawn,regexTest=RegExp.prototype.test;
 let delivered=0,scanned=0;
 t.mock.method(childProcess,'spawn',(...args:Parameters<typeof spawn>)=>{
  const child=spawn(...args),stderr=child.stderr!;
  // Let the real child run while its parent has not yet submitted the private input.
  if(pauseParent)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
  const on=stderr.on;
  t.mock.method(stderr,'on',(event:string,listener:(bytes:Buffer)=>void)=>{
   if(event!=='data')return on.call(stderr,event,listener);
   return on.call(stderr,event,(bytes:Buffer)=>{
    const measured=t.mock.method(RegExp.prototype,'test',function(this:RegExp,value:string){
     scanned+=value.length;
     return regexTest.call(this,value);
    });
    try{
     for(const byte of bytes){delivered++;listener(Buffer.from([byte]));}
    }finally{measured.mock.restore();}
   });
  });
  return child;
 });
 syncBuiltinESMExports();
 try{
  // Rescanning the growing diagnostic transcript would examine about 800 million characters.
  // Consume the request before exiting so a closed stdin pipe cannot mask the diagnostic.
  const result=await runNodeVerifier(['-e',"process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('FATAL ERROR: '+'x'.repeat(39987));console.log('{\"valid\":true}')})"],{input:{}});
  assert.deepEqual(result,{valid:true});
  assert.equal(delivered,40000);
  assert(scanned<=delivered*64,`scanned ${scanned} characters for ${delivered} stderr bytes`);
  t.diagnostic(`scanned ${scanned} characters for ${delivered} stderr bytes`);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();}
});

test('one-byte delivery retains fatal-line boundaries and both heap phrases'+suffix,async t=>{
 const spawn=childProcess.spawn;
 t.mock.method(childProcess,'spawn',(...args:Parameters<typeof spawn>)=>{
  const child=spawn(...args),stderr=child.stderr!,on=stderr.on;
  if(pauseParent)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);
  t.mock.method(stderr,'on',(event:string,listener:(bytes:Buffer)=>void)=>on.call(stderr,event,event==='data'?(bytes:Buffer)=>{
   for(const byte of bytes)listener(Buffer.from([byte]));
  }:listener));
  return child;
 });
 syncBuiltinESMExports();
 try{
  for(const [diagnostic,resource] of [
   ['FATAL ERROR: Reached heap limit',true],
   ['private\nfAtAl ErRoR: JavaScript HEAP OUT OF MEMORY',true],
   ['FATAL ERROR: '+'x'.repeat(20000)+'heap limit',true],
   ['FATAL ERROR: unrelated\nFATAL ERROR: heap out of memory',true],
   ['x FATAL ERROR: heap limit',false],
   ['FATAL ERROR: heap\nlimit',false],
   ['FATAL ERROR: heap \nFATAL ERROR: limit',false],
   ['FATAL ERROR: heap\rlimit',false],
   ['FATAL ERROR: unrelated\rheap limit',false],
   ['FATAL ERROR: unrelated\nheap limit',false],
   ['FATAL ERROR: unrelated\r\nFATAL ERROR: heap limit',true],
   ['FATAL ERROR:heap limit',false],
  ] as const){
   await t.test(JSON.stringify(diagnostic.length>100?diagnostic.slice(0,30)+'…':diagnostic),async()=>{
    const pending=runNodeVerifier(['-e',`process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write(${JSON.stringify(diagnostic)});console.log('{"valid":true}')})`],{input:{}});
    if(resource)await assert.rejects(pending,/^Error: backup.verifier_resource$/);
    else assert.deepEqual(await pending,{valid:true});
   });
  }
 }finally{t.mock.restoreAll();syncBuiltinESMExports();}
});

}
