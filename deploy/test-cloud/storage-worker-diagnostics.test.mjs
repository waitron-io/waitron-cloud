import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';

const execute=promisify(execFile),worker=new URL('./storage-worker.mjs',import.meta.url).pathname;
// Suppressing startup errors or discarding the provider exit hides the cause of a real recovery failure.
for(const [label,source,expected] of [
 ['exit','process.exit(7)',{code:7,signal:null}],
 ['signal','process.kill(process.pid,"SIGTERM")',{code:null,signal:'SIGTERM'}],
 ['spawn error',null,{code:null,signal:null,errorCode:'ENOENT'}],
])test('storage failure retains stage and provider '+label+' without private output',{timeout:15000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'storage-diagnostic-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const injection=`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
 const real=cp.spawn;cp.spawn=(binary,args,options)=>binary==='weed'?
 ${source===null?"real('/missing-synthetic-storage-provider',[],options)":`real(process.execPath,['-e',${JSON.stringify(source)}],options)`}:real(binary,args,options);syncBuiltinESMExports();`;
 const env={...process.env,LOCAL_STACK_CONFIG_DIR:directory,CLOUD_TEST_SERVICE_PLANS:'1'};delete env.NODE_TEST_CONTEXT;
 const failure=await execute(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(injection),worker],{env,timeout:12000}).then(()=>assert.fail('provider failure must refuse startup'),error=>error);
 assert.equal(failure.code,1,failure.stderr);
 const diagnostic=failure.stderr.split('\n').find(line=>line.startsWith('storage_failure='));
 assert.ok(diagnostic,failure.stderr);
 assert.deepEqual(JSON.parse(diagnostic.slice('storage_failure='.length)),{stage:'provider-ready',code:'test_cloud.storage_startup',child:expected});
});

test('storage bootstrap refusal retains only stage and a fixed error code',{timeout:15000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'storage-diagnostic-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await writeFile(join(directory,'runtime.json'),'{"secret":"PRIVATE_CONFIGURATION_CANARY"}',{mode:0o600});
 const env={...process.env,LOCAL_STACK_CONFIG_DIR:directory,CLOUD_TEST_SERVICE_PLANS:'1'};delete env.NODE_TEST_CONTEXT;
 const failure=await execute(process.execPath,[worker],{env,timeout:12000}).then(()=>assert.fail('invalid state must refuse startup'),error=>error);
 assert.equal(failure.code,1,failure.stderr);
 const diagnostic=failure.stderr.split('\n').find(line=>line.startsWith('storage_failure='));
 assert.ok(diagnostic,failure.stderr);
 assert.deepEqual(JSON.parse(diagnostic.slice('storage_failure='.length)),{stage:'bootstrap',code:'local_stack.configuration_invalid',child:null});
 assert.equal(failure.stderr.includes('PRIVATE_CONFIGURATION_CANARY'),false);
});

// The replacement must wait out its killed predecessor's heartbeat instead of refusing the restart.
test('an immediate storage restart waits for its killed owner lease before starting the provider',{timeout:15000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'storage-restart-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const env={...process.env,LOCAL_STACK_CONFIG_DIR:directory,CLOUD_TEST_SERVICE_PLANS:'1'};delete env.NODE_TEST_CONTEXT;
 const injection=action=>`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
 const real=cp.spawn;cp.spawn=(binary,args,options)=>{if(binary==='weed'){${action}}return real(binary,args,options);};syncBuiltinESMExports();`;
 const first=await execute(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(injection('process.kill(process.pid,"SIGKILL");')),worker],{env,timeout:12000}).catch(error=>error);
 assert.equal(first.signal,'SIGKILL',first.stderr);
 const restarted=await execute(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(injection('process.exit(73);')),worker],{env,timeout:12000}).catch(error=>error);
 assert.equal(restarted.code,73,'replacement must reach the provider after the old lease expires: '+restarted.stderr);
});

test('storage restart refuses a live controller after a bounded wait without taking its lease',{timeout:12000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'storage-live-owner-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const {bootstrapStorageIssuer}=await import('./storage-issuer.mjs'),{claimLease}=await import('../local-stack/lease.mjs');
 await bootstrapStorageIssuer(directory);const held=await claimLease(join(directory,'storage-authority/.controller.lock'));t.after(()=>held.release());
 const env={...process.env,LOCAL_STACK_CONFIG_DIR:directory,CLOUD_TEST_SERVICE_PLANS:'1'};delete env.NODE_TEST_CONTEXT;
 const started=performance.now(),failure=await execute(process.execPath,[worker],{env,timeout:9000}).catch(error=>error);
 assert.equal(failure.code,1,failure.stderr);assert.ok(performance.now()-started>=4000,'replacement must allow its bounded lease wait');
 assert.match(failure.stderr,/"stage":"controller-lease","code":"test_cloud.storage_busy"/);
 await held.assertOwned();
});

// Shutdown while waiting for a predecessor must not start a new storage provider.
test('storage shutdown during lease wait exits without starting the provider',{timeout:15000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'storage-cancel-owner-'));
 const {bootstrapStorageIssuer}=await import('./storage-issuer.mjs'),{claimLease}=await import('../local-stack/lease.mjs');
 let held,child,closed;
 t.after(async()=>{if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;await held?.release();await rm(directory,{recursive:true,force:true});});
 await bootstrapStorageIssuer(directory);held=await claimLease(join(directory,'storage-authority/.controller.lock'));
 const waiting=join(directory,'waiting'),signalled=join(directory,'signalled'),provider=join(directory,'provider');
 const injection=`import cp from 'node:child_process';import timers from 'node:timers/promises';import {writeFileSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
 const real=timers.setTimeout;timers.setTimeout=(ms,...args)=>{if(ms===25)writeFileSync(${JSON.stringify(waiting)},'');return real(ms,...args);};
 const spawn=cp.spawn;cp.spawn=(binary,...args)=>{if(binary==='weed'){writeFileSync(${JSON.stringify(provider)},'');process.exit(73);}return spawn(binary,...args);};
 process.once('SIGTERM',()=>writeFileSync(${JSON.stringify(signalled)},''));syncBuiltinESMExports();`;
 const env={...process.env,LOCAL_STACK_CONFIG_DIR:directory,CLOUD_TEST_SERVICE_PLANS:'1'};delete env.NODE_TEST_CONTEXT;
 child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(injection),worker],{env,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',part=>{stderr+=part;});closed=new Promise(resolve=>child.once('close',resolve));
 const wait=async path=>{for(let n=0;n<200;n++){if(await access(path).then(()=>true,()=>false))return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('worker did not reach '+path+': '+stderr);};
 await wait(waiting);child.kill('SIGTERM');await wait(signalled);await held.release();held=undefined;
 assert.equal(await closed,0,stderr);
 assert.equal(await access(provider).then(()=>true,()=>false),false,'shutdown must finish before starting the provider');
 assert.equal(stderr.includes('storage_failure='),false,stderr);
});
