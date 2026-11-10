import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
const scripts=new URL('../../deploy/disposable-tests/',import.meta.url).pathname;
function fixture(t){const root=mkdtempSync(tmpdir()+'/controller-programs-');t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('the staging program separates framed App bytes from the release archive',t=>{
 const root=fixture(t);mkdirSync(root+'/deploy/disposable-tests',{recursive:true});
 writeFileSync(root+'/deploy/disposable-tests/install-controller.py',`import json\nfrom pathlib import Path\ndef prepare_runtime():pass\ndef install(p,env,key):\n Path(p['output']).write_bytes(env+b'|'+key);return {'staged':True}\n`);
 const archive=execFileSync('tar',['-cf','-','-C',root,'deploy']);
 const header={archiveBytes:archive.length,envBytes:8,keyBytes:7,output:root+'/private'};
 const result=spawnSync('python3',['-I','-B',scripts+'stage-controller.py'],{input:Buffer.concat([Buffer.from(JSON.stringify(header)+'\n'),archive,Buffer.from('identitysigning')]),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{staged:true});assert.equal(readFileSync(root+'/private','utf8'),'identity|signing');
});
test('the authorization program preserves existing access and installs its restricted key once',t=>{
 const root=fixture(t);writeFileSync(root+'/authorized_keys','ssh-ed25519 old\n',{mode:0o600});
 const program=`import importlib.util,os,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('authorize',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.KEYS=Path(sys.argv[2]);m.OWNER=os.getuid()\np={'host':'fixture.invalid','key':'ssh-ed25519 new'}\nm.authorize(p);m.authorize(p)\n`;
 const result=spawnSync('python3',['-I','-B','-c',program,scripts+'authorize-controller.py',root+'/authorized_keys'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(root+'/authorized_keys','utf8'),'ssh-ed25519 old\nfrom="fixture.invalid",restrict ssh-ed25519 new\n');
});
test('the probe runs native qualification only after App identity and complete SSH capacity pass',t=>{
 const root=fixture(t);mkdirSync(root+'/scripts/disposable-tests',{recursive:true});mkdirSync(root+'/recipe');
 writeFileSync(root+'/scripts/disposable-tests/github-app.mjs',"export class GithubApp{async get(){return {id:123};}}\n");
 writeFileSync(root+'/scripts/disposable-tests/transport.mjs','export class SSHTransport{constructor(c){this.c=c;}async healthySlots(){return this.c.available;}}\n');
 writeFileSync(root+'/recipe/host-runtime.test.py',`from pathlib import Path\nPath(${JSON.stringify(root+'/native-ran')}).write_text('qualified')\n`);
 for(const available of [[0],[0,1]]){
  writeFileSync(root+'/config.json',JSON.stringify({ci:{repository:'fixture/repo',repositoryId:123},slots:2,available}));
  const result=spawnSync('python3',['-I','-B',scripts+'probe-controller.py'],{input:JSON.stringify({node:process.execPath,configuration:root+'/config.json',recipe:root+'/recipe',peers:['peer.invalid']}),encoding:'utf8',timeout:5000});
  assert.equal(result.status,available.length===2?0:1,result.stderr);
  if(available.length===1)assert.throws(()=>readFileSync(root+'/native-ran'),/ENOENT/);else assert.equal(readFileSync(root+'/native-ran','utf8'),'qualified');
 }
});
