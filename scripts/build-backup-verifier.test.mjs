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
  const streamed=git('rev-parse','HEAD');
  await writeFile(join(candidate,'deploy/backup-verifier/streamed-target.json'),JSON.stringify({runtime:{revision:streamed},digest:'b'.repeat(64)}));
  await writeFile(join(source,'tracked'),'installed release');
  git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-s','-qm','installed fixture');
  const installed=git('rev-parse','HEAD');
  await writeFile(join(candidate,'deploy/backup-verifier/amazon-test-target.json'),JSON.stringify({runtime:{revision:installed},digest:'c'.repeat(64)}));
  await writeFile(join(source,'tracked'),'dirty');
  await writeFile(join(source,'private-untracked'),'must stay out');
  await chmod(join(candidate,'packages/backups/src/container-entry.mjs'),0o600);
  await chmod(join(candidate,'deploy/backup-verifier/target.json'),0o600);
  const modes=join(root,'modes.json');
  const wrapper=join(bin,'docker');await writeFile(wrapper,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),context=process.argv.at(-1),entries=[];
function walk(name){
 const mode=fs.statSync(path.join(context,name)).mode;
 const directory=fs.statSync(path.join(context,name)).isDirectory();
 entries.push({name,mode:mode&0o777,directory});
 if(directory)for(const child of fs.readdirSync(path.join(context,name)))walk(path.join(name,child));
}
walk('waitron');walk('verifier');
fs.writeFileSync(${JSON.stringify(modes)},JSON.stringify({root:fs.statSync(context).mode&0o777,entries}));
fs.cpSync(context,${JSON.stringify(capture)},{recursive:true});`);await chmod(wrapper,0o700);
  const callerMask=process.umask(0o077);
  try{
   execFileSync(process.execPath,[join(candidate,'scripts/build-backup-verifier.mjs')],{env:{...process.env,PATH:bin+':'+process.env.PATH,WAITRON_CHECKOUT:source,NODE_AUTH_TOKEN:'synthetic-build-only'},stdio:'pipe'});
  }finally{process.umask(callerMask);}
  const staged=JSON.parse(await readFile(modes,'utf8'));
  assert.equal(staged.root,0o700,'the build context stays private');
  for(const {name,mode,directory} of staged.entries){
   const required=directory?0o005:0o004;
   assert.equal(mode&required,required,name+' must be readable by the image user');
  }
  assert.equal(await readFile(join(capture,'waitron/tracked'),'utf8'),'pinned');
  await assert.rejects(readFile(join(capture,'waitron/private-untracked')),{code:'ENOENT'});
  assert.deepEqual(JSON.parse(await readFile(join(capture,'waitron/build/hour-release.json'),'utf8')),{sourceCommit:pinned,fixture:'real-generator-boundary'});
  assert.equal(await readFile(join(capture,'verifier/target.json'),'utf8'),await readFile(join(candidate,'deploy/backup-verifier/target.json'),'utf8'));
  execFileSync(process.execPath,[join(candidate,'scripts/build-backup-verifier.mjs'),'--streamed'],
   {env:{...process.env,PATH:bin+':'+process.env.PATH,WAITRON_CHECKOUT:source,NODE_AUTH_TOKEN:'synthetic-build-only'},stdio:'pipe'});
  assert.equal(await readFile(join(capture,'waitron/tracked'),'utf8'),'later','the streamed image must use its separately reviewed release');
  assert.equal(await readFile(join(capture,'verifier/target.json'),'utf8'),await readFile(join(candidate,'deploy/backup-verifier/streamed-target.json'),'utf8'));
  execFileSync(process.execPath,[join(candidate,'scripts/build-backup-verifier.mjs'),'--amazon-test'],
   {env:{...process.env,PATH:bin+':'+process.env.PATH,WAITRON_CHECKOUT:source,NODE_AUTH_TOKEN:'synthetic-build-only'},stdio:'pipe'});
  assert.equal(await readFile(join(capture,'waitron/tracked'),'utf8'),'installed release');
  assert.deepEqual(JSON.parse(await readFile(join(capture,'waitron/build/hour-release.json'),'utf8')),{sourceCommit:installed,fixture:'real-generator-boundary'});
  assert.equal(await readFile(join(capture,'verifier/target.json'),'utf8'),await readFile(join(candidate,'deploy/backup-verifier/amazon-test-target.json'),'utf8'));
 }finally{await rm(root,{recursive:true,force:true});}
});
