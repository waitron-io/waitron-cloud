import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {cliEnvironment} from './fixtures/cli-environment.ts';

const command=fileURLToPath(new URL('../src/traffic-cli.ts',import.meta.url));
const database='postgresql://private-canary:private-canary@127.0.0.1:1/private-canary';
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'traffic-cli-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'reports');await mkdir(directory,{mode:0o2750});await chmod(directory,0o2750);
 const mapping={country:'ES',environment:'test',cellId:randomUUID(),directory,writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const config=join(root,'config.json');
 async function configure(value:unknown={mappings:[mapping]}){await writeFile(config,JSON.stringify(value),{mode:0o600});}
 await configure();return {root,directory,mapping,config,configure};
}
function run(args:string[],env:NodeJS.ProcessEnv={DATABASE_URL:database}){
 return spawnSync(process.execPath,[command,...args],{encoding:'utf8',env:cliEnvironment(env),timeout:10000});
}
function failure(result:ReturnType<typeof run>){
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'remote.traffic_collector_failed\n');
}

// Skipping the poll or starting a database connection for an empty directory breaks a real once run.
test('traffic command polls an explicitly configured empty test directory once and closes',async t=>{
 const f=await fixture(t),result=run([f.config,'--once']);
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
});
for(const scenario of ['missing-file','relative-file','unknown-mode','extra-argument','missing-database','missing-config','malformed-config'] as const)
test(`traffic command refuses ${scenario} without disclosing paths or credentials`,async t=>{
 const f=await fixture(t);let args=[f.config,'--once'],env:NodeJS.ProcessEnv={DATABASE_URL:database};
 if(scenario==='missing-file')args=[];
 if(scenario==='relative-file')args=[relative(process.cwd(),f.config),'--once'];
 if(scenario==='unknown-mode')args=[f.config,'--status'];
 if(scenario==='extra-argument')args.push('private-canary');
 if(scenario==='missing-database')env={DATABASE_URL:undefined};
 if(scenario==='missing-config')args=[join(f.root,'private-canary.json'),'--once'];
 if(scenario==='malformed-config')await writeFile(f.config,'private-canary');
 failure(run(args,env));
});
for(const scenario of ['empty','non-object','extra-field','non-array','duplicate-cell','duplicate-directory','non-test','foreign-country','bad-uid','relative-directory'] as const)
test(`traffic command rejects ${scenario} mapping configuration before collection`,async t=>{
 const f=await fixture(t);let value:unknown={mappings:[f.mapping]};
 if(scenario==='empty')value={mappings:[]};
 if(scenario==='non-object')value=null;
 if(scenario==='extra-field')value={mappings:[f.mapping],secret:'private-canary'};
 if(scenario==='non-array')value={mappings:f.mapping};
 if(scenario==='duplicate-cell')value={mappings:[f.mapping,{...f.mapping,directory:join(f.root,'other')} ]};
 if(scenario==='duplicate-directory')value={mappings:[f.mapping,{...f.mapping,cellId:randomUUID()}]};
 if(scenario==='non-test')value={mappings:[{...f.mapping,environment:'production'}]};
 if(scenario==='foreign-country')value={mappings:[{...f.mapping,country:'FR'}]};
 if(scenario==='bad-uid')value={mappings:[{...f.mapping,writerUid:-1}]};
 if(scenario==='relative-directory')value={mappings:[{...f.mapping,directory:'private-canary'}]};
 await f.configure(value);failure(run([f.config,'--once']));
});
test('traffic command reports collection failure and retains the refused directory',async t=>{
 const f=await fixture(t);await writeFile(join(f.directory,'private-canary.json'),'private-canary');
 const result=run([f.config,'--once']);assert.equal(result.status,1);assert.equal(result.signal,null);assert.equal(result.stdout,'');assert.equal(result.stderr,'remote.traffic_collection_failed\n');
 assert.equal(await readFile(join(f.directory,'private-canary.json'),'utf8'),'private-canary');
});
for(const signal of ['SIGTERM','SIGINT'] as const)test(`traffic command interrupts its poll wait on ${signal}`,async t=>{
 const f=await fixture(t);await writeFile(join(f.directory,'private-canary.json'),'private-canary');
 const child=spawn(process.execPath,[command,f.config],{env:cliEnvironment({DATABASE_URL:database}),stdio:['ignore','pipe','pipe']});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const timer=setTimeout(()=>child.kill('SIGKILL'),5000);let stdout='',stderr='';
 child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>{stderr+=value;if(stderr.includes('remote.traffic_collection_failed\n'))child.kill(signal);});
 try{assert.deepEqual(await exited,{code:0,signal:null});assert.equal(stdout,'');assert.equal(stderr,'remote.traffic_collection_failed\n');}
 finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
});
