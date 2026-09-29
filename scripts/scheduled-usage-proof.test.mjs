import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('failed proof with leftover resources preserves the original failure as its cause',()=>{
 const root=mkdtempSync(join(tmpdir(),'usage-proof-errors-'));
 try{
  writeFileSync(join(root,'docker'),`#!${process.execPath}\nconst args=process.argv.slice(2);if(args.includes('build')||args.includes('down')||args.includes('rm'))process.exit(1);if(args[0]==='ps')console.log('owned-container');\n`,{mode:0o755});
  const script=new URL('./scheduled-usage-proof.mjs',import.meta.url).href;
  const code=`process.argv=[process.execPath,'proof'];try{await import(${JSON.stringify(script)});process.exitCode=2;}catch(error){console.log(JSON.stringify({message:error.message,cause:error.cause?.message}));}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:15000,env:{...process.env,PATH:`${root}:${process.env.PATH}`,NODE_AUTH_TOKEN:'fixture-not-a-secret'}});
  assert.equal(result.status,0,result.stderr);const error=JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.match(error.cause??'',/Command failed: docker compose .* build bootstrap/);
  assert.match(error.message,/"containers":1/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
