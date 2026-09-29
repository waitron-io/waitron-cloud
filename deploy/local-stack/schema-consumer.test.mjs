import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as runtime from './runtime.mjs';

test('consumer schema validation refuses missing, future and changed migrations',async()=>{
 assert.equal(typeof runtime.checkConsumerSchema,'function','runtime must validate schema before spawning a database consumer');
 const root=await mkdtemp(join(tmpdir(),'schema-manifest-'));
 try{
  await mkdir(join(root,'packages/registration/src'),{recursive:true});
  await mkdir(join(root,'packages/registration/migrations'),{recursive:true});
  await writeFile(join(root,'packages/registration/src/migrate.ts'),"export const migrationNames=['001.sql'];");
  await writeFile(join(root,'packages/registration/migrations/001.sql'),'SELECT 1;');
  const expected={name:'001.sql',digest:createHash('sha256').update('SELECT 1;').digest('hex')};
  for(const rows of [[],[expected,{name:'002.sql',digest:'new'}],[{...expected,digest:'changed'}]]){
   await assert.rejects(runtime.checkConsumerSchema({query:async()=>({rows})},root),/schema_incompatible/);
  }
  await runtime.checkConsumerSchema({query:async()=>({rows:[expected]})},root);
 }finally{await rm(root,{recursive:true,force:true});}
});
