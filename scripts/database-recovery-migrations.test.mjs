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

test('billing recovery count follows the actual selected manifest',async()=>{
 const {migrationNames}=await import('../packages/registration/src/migrate.ts');
 assert.equal(hasReleaseMigrationCount(String(migrationNames.length),migrationNames),true);
 assert.equal(hasReleaseMigrationCount(String(migrationNames.length-1),migrationNames),false);
 assert.equal(hasReleaseMigrationCount(String(migrationNames.length+1),migrationNames),false);
 const {migrationRelease}=await import('../packages/registration/test/fixtures/migration-release.ts');
 const old=await migrationRelease(44);try{
  assert.equal(hasReleaseMigrationCount('44',old.names),true);assert.equal(hasReleaseMigrationCount(String(migrationNames.length),old.names),false);
 }finally{await old.close();}
});
