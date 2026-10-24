import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Parent cleanup must require both this run's creation journal and fresh ownership evidence.
for (const fault of ['none', 'wrong-owner', 'wrong-project', 'wrong-id', 'wrong-name', 'wrong-role', 'wrong-network-owner', 'wrong-network-name', 'wrong-listed-id', 'wrong-inspect-count', 'unrecorded']) test(`parent removes only recorded owned stack resources: ${fault}`, async t => {
  const { cleanupRecordedStack } = await import('./fixtures/stack-parent-cleanup.mjs').catch(() => ({}));
  assert.equal(typeof cleanupRecordedStack, 'function', 'provide independent parent cleanup after a child exits');
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'cloud-cleanup-control-')));
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const source=join(parent,'source'),root=join(parent,'owned');mkdirSync(source,{mode:0o700});mkdirSync(root,{mode:0o700});
  const token='a'.repeat(64),id='b'.repeat(64),networkId='c'.repeat(64),foreignId='d'.repeat(64),project='cloud-cost-control';
  const journal={path:join(root,'journal.json'),token},args={source,root,journal};
  writeFileSync(join(root,'.cloud-cost-owner'),token,{mode:0o600});
  writeFileSync(journal.path,JSON.stringify({schemaVersion:1,source,root,ownershipToken:token,localResources:fault==='unrecorded'?[]:[{kind:'container',state:'started',id},{kind:'network',state:'started',id:networkId}]}),{mode:0o600});
  const remaining=new Set([id,networkId,foreignId]);
  const docker=(...argv)=>{
    const selected=argv.at(-1).replace('id=','');
    if(argv.includes('ls')||argv[0]==='ps')return remaining.has(selected)?fault==='wrong-listed-id'?foreignId:selected:'';
    if(argv[0]==='inspect'){const value=[{Id:fault==='wrong-id'?foreignId:id,Name:fault==='wrong-name'?'/foreign':'/'+project+'-'+(fault==='wrong-role'?'foreign':'s3'),Config:{Labels:{'io.waitron.cloud-cost.owner':fault==='wrong-owner'?'foreign':token,'com.docker.compose.project':fault==='wrong-project'?'foreign':project,'io.waitron.cloud-cost.role':fault==='wrong-role'?'foreign':'s3'}}}];if(fault==='wrong-inspect-count')value.push(value[0]);return JSON.stringify(value);}
    if(argv[0]==='network'&&argv[1]==='inspect')return JSON.stringify([{Id:networkId,Name:fault==='wrong-network-name'?'foreign':project,Labels:{'io.waitron.cloud-cost.owner':fault==='wrong-network-owner'?'foreign':token}}]);
    if(argv.includes('rm')){remaining.delete(selected);return '';}
    throw Error('Unexpected external command');
  };
  if(fault.startsWith('wrong-'))assert.throws(()=>cleanupRecordedStack(args,project,docker));
  else {cleanupRecordedStack(args,project,docker);cleanupRecordedStack(args,project,docker);}
  assert.deepEqual([...remaining].sort(),fault==='none'?[foreignId]:fault.startsWith('wrong-network-')?[networkId,foreignId].sort():[id,networkId,foreignId].sort());
});
