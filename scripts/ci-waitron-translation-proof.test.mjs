import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {test} from 'node:test';

const module=await import('./test-waitron-translation.mjs').catch(error=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};
});
const verify=(events,expected={cursors:[0,7,19],releaseAttempts:1})=>{
 assert.equal(typeof module.verifyTranslationTrace,'function','translation trace verifier is implemented');
 module.verifyTranslationTrace(events,expected);
};
const request=(cursor)=>({kind:'request',action:'translation-collect',installationId:'installation',jobId:'job',cursor});
const reply=(cursor,nextCursor,kind='reply')=>({...request(cursor),kind,status:200,body:{version:1,jobId:'job',state:'done',results:[],failed:[],nextCursor}});
const release=(kind='request')=>({kind,action:'translation-release',installationId:'installation',jobId:'job',...(kind==='request'?{}:{status:200,body:{version:1,jobId:'job',state:'collected'}})});
const walk=()=>[request(0),reply(0,7),request(7),reply(7,19),request(19),reply(19,null),release(),release('reply')];

test('offsets follow actual nextCursor',()=>{
 verify(walk());
 const wrong=walk();wrong[1].body.nextCursor=1;assert.throws(()=>verify(wrong),/continuation/);
 const reversed=walk();reversed[3].body.nextCursor=0;assert.throws(()=>verify(reversed),/continuation/);
 const other=walk();other[3].body.jobId='another';assert.throws(()=>verify(other),/binding/);
 const otherInstallation=walk();otherInstallation[2].installationId='another';assert.throws(()=>verify(otherInstallation),/binding/);
 const orphan=walk();orphan.splice(2,1);assert.throws(()=>verify(orphan),/request|cursor/);
});
test('same-cursor retry is explicit',()=>{
 const events=[request(0),reply(0,7),request(7),reply(7,19,'lost'),request(7),reply(7,19),...walk().slice(4)];
 verify(events,{cursors:[0,7,7,19],releaseAttempts:1});
 assert.throws(()=>verify(events),/cursor/);
 const repeatedSuccess=[...walk().slice(0,4),request(7),reply(7,19),...walk().slice(4)];
 assert.throws(()=>verify(repeatedSuccess,{cursors:[0,7,7,19],releaseAttempts:1}),/continuation/);
 const changedRetry=structuredClone(events);changedRetry[5].body.nextCursor=23;
 assert.throws(()=>verify(changedRetry,{cursors:[0,7,7,19],releaseAttempts:1}),/retry|continuation/);
 const changedContents=structuredClone(events);changedContents[5].body.results=[{ref:'different-result'}];
 assert.throws(()=>verify(changedContents,{cursors:[0,7,7,19],releaseAttempts:1}),/retry/);
});
test('release needs the null-cursor reply',()=>{
 assert.throws(()=>verify(walk().slice(0,2),{cursors:[0],releaseAttempts:0}),/final/);
 const missing=walk();missing.splice(5,1);assert.throws(()=>verify(missing),/final|reply/);
 const lostFinal=walk();lostFinal[5].kind='lost';assert.throws(()=>verify(lostFinal),/final|reply/);
 const early=[...walk().slice(0,4),release(),release('reply')];assert.throws(()=>verify(early,{cursors:[0,7],releaseAttempts:1}),/final/);
 assert.throws(()=>verify([...walk(),release(),release('reply')]),/release/);
 assert.throws(()=>verify(walk(),{cursors:[0,7,19],releaseAttempts:2}),/release attempts/);
 const lostRelease=walk();lostRelease[7].kind='lost';lostRelease.push(release(),release('reply'));
 verify(lostRelease,{cursors:[0,7,19],releaseAttempts:2});
 const extra=walk();extra.push(release(),release('reply'));
 assert.throws(()=>verify(extra,{cursors:[0,7,19],releaseAttempts:2}),/release/);
});
test('collect after release is refused',()=>{
 const events=[...walk(),request(19),reply(19,null)];
 assert.throws(()=>verify(events,{cursors:[0,7,19,19],releaseAttempts:1}),/after release/);
});
test('unknown command input fails before setup',()=>{
 for(const args of [['--nonsense'],['--case','unknown'],['--case'],['--case','baseline','extra']]){
  const env={...process.env};delete env.WAITRON_CHECKOUT;delete env.TEST_DATABASE_URL;
  const result=spawnSync(process.execPath,['scripts/test-waitron-translation.mjs',...args],{encoding:'utf8',env,timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/translation_proof_arguments_invalid/);assert.equal(result.stdout,'');
 }
});
for(const signal of [null,'SIGKILL'])test(`child cleanup records ${signal??'code zero'} without signalling an exited child`,async()=>{
 assert.equal(typeof module.trackTranslationChild,'function','child lifecycle tracker is implemented');
 const child=spawn(process.execPath,['-e',signal?'setInterval(()=>{},1000)':'process.exit(0)'],{stdio:'ignore'});
 try{
  const running=module.trackTranslationChild(child);
  if(signal)child.kill(signal);
  assert.deepEqual(await running.done,signal?{code:null,signal}:{code:0,signal:null});
  assert.equal(running.exited,true);
  child.kill=()=>{assert.fail('must not signal an exited process');};
  assert.deepEqual(await running.stop(),signal?{code:null,signal}:{code:0,signal:null});
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});
test('failed spawn still permits the rest of setup cleanup',async()=>{
 const child=spawn('/missing/translation-proof-executable',[],{stdio:'ignore'});
 const running=module.trackTranslationChild(child);
 assert.deepEqual(await running.done,{code:null,signal:null,error:'spawn_failed'});
 assert.equal(running.exited,true);
 assert.deepEqual(await running.stop(),{code:null,signal:null,error:'spawn_failed'});
});
