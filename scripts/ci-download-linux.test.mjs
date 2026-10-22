import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';

const execute=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
for(const [mode,name] of [['detached','reaps a detached session before retry'],['stale','rejects stale process ownership data'],['uncertain','refuses retry when owned cleanup cannot be confirmed'],['unavailable','refuses missing stable process handles before install'],['adoption-refused','refuses rejected descendant adoption before install']]){
test(`Linux supervision ${name} and preserves an unrelated lock holder`, {
  skip:process.platform!=='linux'&&!process.env.CI_DOWNLOAD_LINUX_IMAGE,
  timeout:15000,
}, async t=>{
  const args=['scripts/fixtures/ci-download-linux.py','scripts/ci-download.py',mode];
  let output;
  if(process.platform==='linux')output=await execute('python3',args,{cwd:root});
  else{
    const scratch=await mkdtemp(join(tmpdir(),'ci-download-linux-')),cidfile=join(scratch,'container.cid');
    t.after(async()=>{
      const id=await readFile(cidfile,'utf8').catch(()=>null);
      if(id)await execute('docker',['rm','-f',id.trim()]);
      await rm(scratch,{recursive:true,force:true});
    });
    output=await execute('docker',['run','--pull=never','--name','cloud-download-test-'+randomUUID(),
      '--cidfile',cidfile,'--volume',root+':/fixture:ro','--workdir','/fixture',
      process.env.CI_DOWNLOAD_LINUX_IMAGE,'python3',...args],{timeout:10000});
  }
  assert.deepEqual(JSON.parse(output.stdout),['unavailable','adoption-refused'].includes(mode)
    ?{attempts:0,ownershipUnavailable:true,unrelatedAlive:true}
    :mode==='uncertain'?{attempts:1,cleanupUnconfirmed:true,unrelatedAlive:true}
      :{attempts:2,detachedGone:true,unrelatedAlive:true});
});
}
