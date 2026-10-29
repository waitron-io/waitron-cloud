import assert from 'node:assert/strict';
import test from 'node:test';
import {hasReleaseMigrationCount} from './database-recovery-migrations.mjs';

for(const size of [2,28]){
 test(`accepts all ${size} migrations from the selected release`,()=>{
  const manifest=Array.from({length:size},(_,index)=>`${index+1}_change.sql`);
  assert.equal(hasReleaseMigrationCount(String(size),manifest),true);
 });
}
test('refuses a database missing a release migration',()=>{
 const manifest=Array.from({length:27},(_,index)=>`${index+1}_change.sql`);
 assert.equal(hasReleaseMigrationCount('26',manifest),false);
});
test('refuses a database with an extra migration',()=>{
 const manifest=['001_initial.sql','002_next.sql'];
 assert.equal(hasReleaseMigrationCount('3',manifest),false);
});
