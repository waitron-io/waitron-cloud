import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
const cloud=fileURLToPath(new URL('../',import.meta.url));
test('verifier build archives the pinned committed source and supplies its generated runtime stamp',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-build-contract-')),source=join(root,'source'),candidate=join(root,'cloud'),bin=join(root,'bin'),capture=join(root,'capture');
 try{
  for(const name of [source,bin,join(candidate,'scripts'),join(candidate,'deploy/backup-verifier'),join(candidate,'packages/backups')])await mkdir(name,{recursive:true});
  await cp(join(cloud,'scripts/build-backup-verifier.mjs'),join(candidate,'scripts/build-backup-verifier.mjs'));
  await cp(join(cloud,'packages/backups/src'),join(candidate,'packages/backups/src'),{recursive:true});
  await cp(join(cloud,'deploy/backup-verifier/Dockerfile'),join(candidate,'deploy/backup-verifier/Dockerfile'));
  await mkdir(join(source,'scripts'));await writeFile(join(source,'package.json'),'{"type":"module"}');
  await writeFile(join(source,'scripts/generate-hour-release.mjs'),`import {execFileSync} from 'node:child_process';export function generateHourRelease({cwd,source}){const resolved=execFileSync('git',['rev-parse',source],{cwd,encoding:'utf8'}).trim();return {sourceCommit:resolved,fixture:'real-generator-boundary'};}`);
  await writeFile(join(source,'tracked'),'pinned');
  const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
  git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-s','-qm','fixture');const pinned=git('rev-parse','HEAD');
  await writeFile(join(candidate,'deploy/backup-verifier/target.json'),JSON.stringify({runtime:{revision:pinned},digest:'a'.repeat(64)}));
  await writeFile(join(source,'tracked'),'later');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-s','-qm','later fixture');
  await writeFile(join(source,'private-untracked'),'must stay out');
  const wrapper=join(bin,'docker');await writeFile(wrapper,`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.cpSync(args.at(-1),${JSON.stringify(capture)},{recursive:true});`);await chmod(wrapper,0o700);
  execFileSync(process.execPath,[join(candidate,'scripts/build-backup-verifier.mjs')],{env:{...process.env,PATH:bin+':'+process.env.PATH,WAITRON_CHECKOUT:source,NODE_AUTH_TOKEN:'synthetic-build-only'},stdio:'pipe'});
  assert.equal(await readFile(join(capture,'waitron/tracked'),'utf8'),'pinned');
  await assert.rejects(readFile(join(capture,'waitron/private-untracked')),{code:'ENOENT'});
  assert.deepEqual(JSON.parse(await readFile(join(capture,'waitron/build/hour-release.json'),'utf8')),{sourceCommit:pinned,fixture:'real-generator-boundary'});
  assert.equal(await readFile(join(capture,'verifier/target.json'),'utf8'),await readFile(join(candidate,'deploy/backup-verifier/target.json'),'utf8'));
 }finally{await rm(root,{recursive:true,force:true});}
});
