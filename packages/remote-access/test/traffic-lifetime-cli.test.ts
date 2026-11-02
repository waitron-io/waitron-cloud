import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstat,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {cliEnvironment} from './fixtures/cli-environment.ts';

const command=fileURLToPath(new URL('../src/traffic-lifetime-cli.ts',import.meta.url));
const database='postgresql://private-canary:private-canary@127.0.0.1:1/private-canary';
async function fixture(t:{after:(f:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'lc-')));t.after(()=>rm(root,{recursive:true,force:true}));const config=join(root,'config.json'),socket=join(root,'country.sock');
 const mapping={country:'ES',environment:'test',cellId:randomUUID(),directory:join(root,'reports'),writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const configure=(value:unknown={socket,mappings:[mapping]})=>writeFile(config,JSON.stringify(value),{mode:0o600});await configure();return {root,config,socket,mapping,configure};
}
function run(args:string[],env:NodeJS.ProcessEnv={DATABASE_URL:database}){return spawnSync(process.execPath,[command,...args],{encoding:'utf8',env:cliEnvironment(env),timeout:5000});}
for(const name of ['no-file','relative-file','extra-argument','no-database','missing-config','malformed','extra-field','empty','invalid-later','duplicate-cell','duplicate-directory','relative-socket'] as const)
test(`lifetime command refuses ${name} with a fixed diagnostic before binding`,async t=>{
 const f=await fixture(t);let args=[f.config],env:NodeJS.ProcessEnv={DATABASE_URL:database};
 if(name==='no-file')args=[];
 if(name==='relative-file')args=[relative(process.cwd(),f.config)];
 if(name==='extra-argument')args.push('--once');
 if(name==='no-database')env={DATABASE_URL:undefined};
 if(name==='missing-config')args=[join(f.root,'private-canary')];
 if(name==='malformed')await writeFile(f.config,'private-canary');
 if(name==='extra-field')await f.configure({socket:f.socket,mappings:[f.mapping],extra:true});
 if(name==='empty')await f.configure({socket:f.socket,mappings:[]});
 if(name==='invalid-later')await f.configure({socket:f.socket,mappings:[f.mapping,{...f.mapping,environment:'production'}]});
 if(name==='duplicate-cell')await f.configure({socket:f.socket,mappings:[f.mapping,{...f.mapping,directory:join(f.root,'other')}]});
 if(name==='duplicate-directory')await f.configure({socket:f.socket,mappings:[f.mapping,{...f.mapping,cellId:randomUUID()}]});
 if(name==='relative-socket')await f.configure({socket:'private-canary.sock',mappings:[f.mapping]});
 const r=run(args,env);assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,'remote.traffic_lifetime_server_failed\n');await assert.rejects(lstat(f.socket),/ENOENT/);
});
for(const signal of ['SIGTERM','SIGINT'] as const)test(`lifetime command owns a private socket and closes without database work on ${signal}`,async t=>{
 const f=await fixture(t),child=spawn(process.execPath,[command,f.config],{env:cliEnvironment({DATABASE_URL:database}),stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>child.once('exit',(code,signal)=>r({code,signal}))),timer=setTimeout(()=>child.kill('SIGKILL'),5000);
 try{
  let ready=false;for(let n=0;n<150;n++){ready=await lstat(f.socket).then(s=>s.isSocket()&&(s.mode&0o7777)===0o600).catch(()=>false);if(ready||child.exitCode!==null)break;await delay(10);}
  assert.equal(ready,true,err);child.kill(signal);assert.deepEqual(await exited,{code:0,signal:null});assert.equal(out,'');assert.equal(err,'');await assert.rejects(lstat(f.socket),/ENOENT/);
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
});
