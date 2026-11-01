import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {bootstrapTestCloud} from '../deploy/test-cloud/bootstrap.mjs';

const root=new URL('../',import.meta.url);
async function command(file,args,env,stopOnChange){
 const child=spawn(process.execPath,[new URL(file,root).pathname,...args],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
 const deadline=setTimeout(()=>child.kill('SIGKILL'),10000);
 const changed=stopOnChange?setInterval(()=>{try{if(readFileSync(stopOnChange.file,'utf8')!==stopOnChange.before)child.kill('SIGTERM');}catch{child.kill('SIGTERM');}},20):undefined;
 try{const [code,signal]=await once(child,'close');return {code,signal,stdout,stderr};}
 finally{clearTimeout(deadline);clearInterval(changed);}
}

for(const flags of [
 {CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'production'},
 {CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:'test'},
])for(const [file,args] of [
 ['packages/translation/src/worker-cli.ts',['--once']],
 ['packages/backups/src/worker-cli.ts',['--status']],
 ['deploy/test-cloud/backup-worker.mjs',['--status']],
 ['packages/account-http/src/server-cli.ts',[]],
 ['deploy/test-cloud/account-worker.mjs',[]],
 ['packages/registration/src/organisation-plan-cli.ts',['show','--organisation','11111111-1111-4111-8111-111111111111']],
])test(`${file} refuses ${JSON.stringify(flags)} before connecting to a database`,async()=>{
 let connections=0;
 const server=createServer(socket=>{connections++;socket.destroy();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const result=await command(file,args,{...flags,NODE_ENV:'test',DATABASE_URL:`postgres://fixture:fixture@127.0.0.1:${server.address().port}/fixture`,CLOUD_OPENAI_API_KEY:'local-fixture-key',CLOUD_OPENAI_BASE_URL:'',CLOUD_PORTAL_ORIGIN:'https://cloud.example.test',CLOUD_HTTP_RATE_KEY:'a'.repeat(64),CLOUD_EMAIL_ACTIVE_KEY_ID:'fixture',CLOUD_EMAIL_KEYS:JSON.stringify({fixture:'b'.repeat(64)})});
  assert.equal(result.signal,null);assert.equal(result.code,1);assert.equal(result.stdout,'');
  assert.equal(connections,0,'invalid authority settings must fail before database work');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

for(const flags of [
 {CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'production'},
 {CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:'test'},
 {CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'test'},
])test(`manifest worker selects venue authority before refreshing private routes ${JSON.stringify(flags)}`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'venue-manifest-cli-'));let connections=0;
 const server=createServer(socket=>{connections++;socket.destroy();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await bootstrapTestCloud(directory);const file=join(directory,'gateway-sequence'),before=await readFile(file,'utf8');
  const result=await command('deploy/test-cloud/remote-worker.mjs',[],{...flags,LOCAL_STACK_CONFIG_DIR:directory,DATABASE_URL:`postgres://fixture:fixture@127.0.0.1:${server.address().port}/fixture`},{file,before});
  assert.deepEqual([result.code,result.signal,result.stdout],[1,null,'']);
  assert.equal(result.stderr,'Test remote worker failed; inspect private state and schema\n');
  assert.equal(await readFile(file,'utf8'),before,'venue mode must never run the legacy empty-route refresher');
  assert.equal(connections,flags.CLOUD_TEST_SERVICE_PLANS==='0'&&flags.CLOUD_VENUE_SERVICE_LEVELS==='test'?1:0);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
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

for(const flags of [
 {CLOUD_TEST_SERVICE_PLANS:'0',CLOUD_VENUE_SERVICE_LEVELS:'production'},
 {CLOUD_TEST_SERVICE_PLANS:'1',CLOUD_VENUE_SERVICE_LEVELS:'test'},
])for(const role of ['reconciler','operator'])test(`${role} command refuses invalid authority before database work ${JSON.stringify(flags)}`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'venue-remote-cli-'));let connections=0;
 const server=createServer(socket=>{connections++;socket.destroy();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const file=join(directory,'config.json'),dns=join(directory,'dns.mjs'),key=join(directory,'key.pem');
  await writeFile(dns,'export default {async present(){},async remove(){}};');await writeFile(key,'local-fixture');
  await writeFile(file,JSON.stringify(role==='operator'?{id:'11111111-1111-4111-8111-111111111111',country:'ES',provider:'aws',environment:'test',suffix:'example.test',subnet:1,publicKey:Buffer.alloc(32,1).toString('base64'),endpoint:'gateway.example.test:51820'}:{routes:[],certificates:[],acme:{directoryUrl:'https://acme.example.test/directory',email:'fixture@example.test',accountKeyFile:key,dnsModule:dns}}));
  const result=await command(`packages/remote-access/src/${role==='operator'?'operator-cli':'reconciler-cli'}.ts`,role==='operator'?['cell',file]:[file,'--status'],{...flags,DATABASE_URL:`postgres://fixture:fixture@127.0.0.1:${server.address().port}/fixture`});
  assert.equal(result.code,1);assert.equal(result.signal,null);assert.equal(result.stdout,'');
  assert.equal(connections,0,'invalid authority must be refused before a remote operation');
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
