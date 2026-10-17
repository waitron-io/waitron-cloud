import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {before,test} from 'node:test';

const root=fileURLToPath(new URL('../../../',import.meta.url)),image='node:26';
// Image download has a separate setup budget; the runtime check retains its test deadline.
before(()=>{
 try{execFileSync('docker',['image','inspect',image],{stdio:'ignore',timeout:10000});}
 catch{execFileSync('docker',['pull',image],{stdio:'pipe',timeout:120000});}
},{timeout:150000});

test('the packaged translation launcher checks migration digests before dispatching the worker',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'translation-runtime-')),project='translation-runtime-'+randomUUID();
 const override=join(directory,'compose.yaml');
 // Match the release image's working directory while mounting this exact candidate read-only.
 await writeFile(override,`services:
  bootstrap:
    image: ${image}
    working_dir: /app
    volumes:
      - ${JSON.stringify(root+':/app:ro')}
  migrate:
    image: ${image}
    working_dir: /app
    volumes:
      - ${JSON.stringify(root+':/app:ro')}
  postgres:
    ports: !reset []
  translation-worker:
    image: ${image}
    working_dir: /app
    volumes:
      - ${JSON.stringify(root+':/app:ro')}
`);
 const prefix=['compose','--project-name',project,'--env-file',join(root,'deploy/local-stack/local.env'),'-f',join(root,'compose.yaml'),'-f',override,'--profile','translation'];
 const env={...process.env,COMPOSE_PROFILES:'',CLOUD_OPENAI_API_KEY:'local-fake-key',CLOUD_OPENAI_BASE_URL:'http://127.0.0.1:9/v1'};
 const compose=(...args:string[])=>spawnSync('docker',[...prefix,...args],{encoding:'utf8',env,timeout:20000});
 const success=(...args:string[])=>{const value=compose(...args);assert.equal(value.status,0,value.stdout+value.stderr);return value.stdout;};
 try{
  success('up','-d','--no-build','translation-worker');
  const child=success('exec','-T','translation-worker','node','--input-type=module','-e',
   "import{readdirSync,readFileSync}from'node:fs';const ready=()=>readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).some(pid=>{try{return readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0').includes('packages/translation/src/worker-cli.ts')}catch{return false}});for(let i=0;i<100;i++){if(ready()){console.log(true);process.exit(0)}await new Promise(r=>setTimeout(r,50))}console.log(false);");
  assert.equal(child.trim(),'true');
  success('stop','translation-worker');
  success('exec','-T','postgres','psql','-U','cloud','-d','cloud','-c',"UPDATE schema_migrations SET digest=repeat('0',64) WHERE name=(SELECT name FROM schema_migrations ORDER BY name LIMIT 1)");
  const invalid=spawnSync('docker',[...prefix,'run','--rm','--no-deps','translation-worker'],{encoding:'utf8',env,timeout:10000});
  assert.equal(invalid.status,1,invalid.stdout+invalid.stderr);
  assert.match(invalid.stderr,/Local stack process failed; check its private configuration and service prerequisites/);
  assert.doesNotMatch(invalid.stderr,/Translation worker failed/);
 }finally{
  try{success('down','--volumes','--remove-orphans');}finally{await rm(directory,{recursive:true,force:true});}
 }
});
