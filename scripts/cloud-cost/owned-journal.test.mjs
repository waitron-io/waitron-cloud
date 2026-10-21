import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cost-journal-check-'))), source = join(parent, 'source'), root = join(parent, 'owned');
  for (const path of [source, root]) mkdirSync(path, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), journal = { token, path: join(root, 'journal.json') };
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(journal.path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  t.after(() => rmSync(parent, { recursive: true })); return { source, root, journal };
}
const run = (f, code) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import assert from 'node:assert/strict'; import {join} from 'node:path';
  import {spawnSync} from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
  const f=JSON.parse(process.argv[1]); const originalWrite=fs.writeFileSync;
  const originalOpen=fs.openSync; let staging;
  fs.openSync=(path,...args)=>{const fd=originalOpen(path,...args); if(String(path).includes('.cloud-cost-journal-'))staging=fd; return fd;};
  ${code}
`, JSON.stringify(f)], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, LANG: 'C', TZ: 'UTC' } });

// Publishing after ownership changes would replace a journal that is no longer ours.
test('changedOwnershipBeforePublicationLeavesTheOriginalJournalUntouched', t => {
  const f = fixture(t), result = run(f, `
    const before=fs.readFileSync(f.journal.path,'utf8'); let changed=false;
    fs.writeFileSync=(fd,...args)=>{const result=originalWrite(fd,...args);if(fd===staging){changed=true;originalWrite(join(f.root,'.cloud-cost-owner'),'0'.repeat(64));}return result;};
    syncBuiltinESMExports(); const {recordOwnedResource}=await import(${JSON.stringify(new URL('./owned-journal.mjs', import.meta.url).href)});
    assert.throws(()=>recordOwnedResource(f,{kind:'synthetic',state:'intent'}),{message:'Invalid cloud cost evidence'});
    assert.equal(changed,true);assert.equal(fs.readFileSync(f.journal.path,'utf8'),before);
    assert.equal(fs.readdirSync(f.root).some(name=>name.startsWith('.cloud-cost-journal-')),false);
  `);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
});

// A real observer reads the published path while a staged write is only half complete.
test('observersSeeCompleteOldJsonDuringWritingAndCompleteNewJsonAfterPublication', t => {
  const f = fixture(t), result = run(f, `
    let observed=false;
    fs.writeFileSync=(fd,text,...args)=>{
      if(fd!==staging)return originalWrite(fd,text,...args);
      const bytes=Buffer.from(text),half=Math.floor(bytes.length/2);originalWrite(fd,bytes.subarray(0,half));
      const child=spawnSync(process.execPath,['--input-type=module','-e',
        "import fs from 'node:fs';const value=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(value.localResources?.length??0));",f.journal.path],{encoding:'utf8',timeout:2000});
      assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'0');observed=true;
      return originalWrite(fd,bytes.subarray(half));
    };
    syncBuiltinESMExports();const {recordOwnedResource}=await import(${JSON.stringify(new URL('./owned-journal.mjs', import.meta.url).href)});
    recordOwnedResource(f,{kind:'synthetic',state:'intent',id:'one'});
    assert.equal(observed,true);assert.deepEqual(JSON.parse(fs.readFileSync(f.journal.path,'utf8')).localResources,[{kind:'synthetic',state:'intent',id:'one'}]);
  `);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
});
