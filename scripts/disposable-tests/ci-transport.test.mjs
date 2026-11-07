import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
for(const resource of ['dt-fixture-0-1','dt-fixture-5-1'])test('CI transport sends public identity and transient JIT over separate stdin channels',t=>{
 const root=mkdtempSync(join(tmpdir(),'ci-transport-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'bin'));
 writeFileSync(join(root,'bin/ssh'),`#!/usr/bin/env python3
import sys,json,os
command=sys.argv[-1]
raw=sys.stdin.read()
with open(os.environ['CI_TEST_CALLS'],'a') as out:out.write(json.dumps({'argv':sys.argv,'input':raw})+'\\n')
if ' result ' in command:print(json.dumps({'resourceId':${JSON.stringify(resource)},'code':3}))
`,{mode:0o700});
 const program=`import {CITransport} from ${JSON.stringify(new URL('./transport.mjs',import.meta.url).href)};
 const transport=new CITransport({host:'fixture.invalid',recipe:'/opt/waitron-disposable-fixture'});
 const lease={resourceId:${JSON.stringify(resource)},snapshot:'a'.repeat(64),argv:['fixed'],deadline:123,ci:{runId:1},lane:'I',turn:'ci-1-1'};
 await transport.transfer(lease,{signal:AbortSignal.timeout(3000)});
 console.log(await transport.execute(lease,{signal:AbortSignal.timeout(3000),jitconfig:'synthetic-credential'}));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',program],{encoding:'utf8',timeout:6000,
 env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,CI_TEST_CALLS:join(root,'calls'),XDG_CACHE_HOME:join(root,'cache')}});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stdout.trim(),'3');
 const calls=readFileSync(join(root,'calls'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(calls.length,3);assert.equal(calls[0].argv.at(-1).includes('transfer-ci'),true);
 assert.deepEqual(Object.keys(JSON.parse(calls[0].input)).sort(),['argv','ci','deadline','resourceId','snapshot']);
 assert.deepEqual(JSON.parse(calls[1].input),{jitconfig:'synthetic-credential'});
 assert.equal(JSON.stringify(calls.map(c=>c.argv)).includes('synthetic-credential'),false);
 assert.equal(result.stdout.includes('synthetic-credential'),false);assert.equal(result.stderr.includes('synthetic-credential'),false);
});
