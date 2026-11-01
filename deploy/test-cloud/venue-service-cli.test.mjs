import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

const root=new URL('../../',import.meta.url);
async function command(file,args,env){
 const child=spawn(process.execPath,[new URL(file,root).pathname,...args],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
 const deadline=setTimeout(()=>child.kill('SIGKILL'),10000);
 try{const [code,signal]=await once(child,'close');return {code,signal,stdout,stderr};}
 finally{clearTimeout(deadline);}
}

for(const flags of [
 {CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'production'},
 {CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:'test'},
])for(const [file,args] of [
 ['packages/translation/src/worker-cli.ts',['--once']],
 ['packages/backups/src/worker-cli.ts',['--status']],
])test(`${file} refuses ${JSON.stringify(flags)} before connecting to a database`,async()=>{
 let connections=0;
 const server=createServer(socket=>{connections++;socket.destroy();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const result=await command(file,args,{...flags,DATABASE_URL:`postgres://fixture:fixture@127.0.0.1:${server.address().port}/fixture`,CLOUD_OPENAI_API_KEY:'local-fixture-key',CLOUD_OPENAI_BASE_URL:''});
  assert.equal(result.signal,null);assert.equal(result.code,1);assert.equal(result.stdout,'');
  assert.equal(connections,0,'invalid authority settings must fail before database work');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('forward collector validates venue authority even with no configured mappings',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'venue-cli-'));
 try{
  const file=join(directory,'mapping.json');await writeFile(file,JSON.stringify({mappings:[]}));
  for(const [flags,code] of [
   [{CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'test'},0],
   [{CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'0'},0],
   [{CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:'0'},0],
   [{CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:'test'},1],
   [{CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'production'},1],
  ]){
   const result=await command('packages/remote-access/src/forward-report-cli.ts',[file,'--once'],{...flags,DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:1/fixture'});
   assert.deepEqual([result.code,result.signal,result.stdout],[code,null,''],JSON.stringify(flags));
   assert.equal(result.stderr,code?'remote.forward_collector_failed\n':'');
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
