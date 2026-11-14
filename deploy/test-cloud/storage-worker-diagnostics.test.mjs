import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
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
