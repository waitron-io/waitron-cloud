import assert from 'node:assert/strict';
import {test} from 'node:test';

import * as module from './fixtures/bound-fixture-cleanup.ts';
const id='1'.repeat(64),peer='2'.repeat(64),image='sha256:'+'3'.repeat(64);
const labels:Record<string,string>={'cloud.backup-verifier.owner':'owned-fixture','cloud.backup-verifier.scope':'scope','cloud.backup-verifier.token':'token','cloud.backup-verifier.claim':'claim','cloud.backup-verifier.request':'digest','cloud.backup-verifier.deadline':'123'};
function fixture(){
 assert.equal(typeof module.boundFixtureCleanup,'function','owned fixture cleanup is missing');
 const children=new Map([[id,{Id:id,Image:image,Config:{Labels:{...labels}}}],[peer,{Id:peer,Image:image,Config:{Labels:{...labels}}}]]),removed:string[]=[];
 const docker=(...args:string[])=>{
  if(args[0]==='inspect'){
   const child=children.get(args[1]!);if(child)return JSON.stringify([child]);
   throw Object.assign(Error('missing'),{status:1,signal:null,stderr:'Error: No such object: '+args[1]});
  }
  assert.deepEqual(args,['rm','-f',id]);removed.push(args[2]!);children.delete(args[2]!);return id;
 };
 const cleanup=module.boundFixtureCleanup(docker);cleanup.record({id,image,labels});
 return {cleanup,children,removed,docker};
}
test('failed bound fixture cleanup removes only its recorded child and preserves the original error',()=>{
 const {cleanup,children,removed}=fixture(),original=Error('backup.verifier_cleanup');
 assert.throws(()=>{try{throw original;}finally{cleanup.release();}},error=>error===original);
 assert.deepEqual(removed,[id]);assert.equal(children.has(id),false);assert.equal(children.has(peer),true);
 cleanup.release();assert.deepEqual(removed,[id]);
});
for(const field of ['Id','Image',...Object.keys(labels)])test(`fixture rescue refuses a changed ${field}`,()=>{
 const {cleanup,children,removed}=fixture(),child=children.get(id)!;
 if(field==='Id'||field==='Image')child[field]='foreign';else child.Config.Labels[field]='foreign';
 assert.throws(()=>cleanup.release(),/bound_fixture.cleanup/);assert.deepEqual(removed,[]);assert.equal(children.size,2);
});
test('fixture rescue accepts exact absence but preserves command failures',()=>{
 const {cleanup,children,removed}=fixture();children.delete(id);cleanup.release();assert.deepEqual(removed,[]);
 for(const error of [Object.assign(Error('refused'),{status:1,stderr:'permission denied'}),Object.assign(Error('interrupted'),{status:1,signal:'SIGTERM',stderr:'Error: No such object: '+id})]){
  const refused=module.boundFixtureCleanup(()=>{throw error;});refused.record({id,image,labels});assert.throws(()=>refused.release(),/bound_fixture.cleanup/);
 }
});
test('fixture rescue confirms removal and keeps failed ownership evidence for a later attempt',()=>{
 const {children,docker}=fixture();let retained=true;
 const cleanup=module.boundFixtureCleanup((...args:string[])=>args[0]==='rm'&&retained?'':docker(...args));cleanup.record({id,image,labels});
 assert.throws(()=>cleanup.release(),/bound_fixture.cleanup/);assert.equal(children.has(id),true);
 retained=false;cleanup.release();assert.equal(children.has(id),false);
});
test('fixture rescue snapshots the recorded labels and attempts each recorded child after a failure',()=>{
 const {children,docker}=fixture(),recorded={...labels},other='4'.repeat(64);children.set(other,{Id:other,Image:image,Config:{Labels:{...labels}}});
 const cleanup=module.boundFixtureCleanup((...args:string[])=>{if(args[1]===id)throw Error('refused');if(args[0]==='rm'){children.delete(args[2]!);return '';}return docker(...args);});
 cleanup.record({id,image,labels:recorded});cleanup.record({id:other,image,labels:recorded});recorded['cloud.backup-verifier.owner']='changed';
 assert.throws(()=>cleanup.release(),/bound_fixture.cleanup/);assert.equal(children.has(id),true);assert.equal(children.has(other),false);assert.equal(children.has(peer),true);
});
test('fixture rescue refuses malformed inspect output without removing anything',()=>{
 for(const value of [null,{},[],{length:0},[null],[{Id:id,Image:image,Config:{Labels:labels}},{Id:peer}]]){
  let removed=false;const cleanup=module.boundFixtureCleanup((...args:string[])=>{if(args[0]==='rm')removed=true;return JSON.stringify(value);});cleanup.record({id,image,labels});
  assert.throws(()=>cleanup.release(),/bound_fixture.cleanup/);assert.equal(removed,false);
 }
});
test('fixture rescue refuses incomplete ownership records before inspecting or removing',()=>{
 const cleanup=module.boundFixtureCleanup(()=>assert.fail('invalid records cannot reach Docker'));
 for(const bad of [{id:'bad',image,labels},{id,image:'mutable-tag',labels},{id,image,labels:{}},{id,image,labels:{...labels,unexpected:'field'}},{id,image,labels:{...labels,'cloud.backup-verifier.owner':''}}])assert.throws(()=>cleanup.record(bad),/bound_fixture.record/);
});
