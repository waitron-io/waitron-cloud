import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpathSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as release from './replay-release.mjs';

test('currentReplayRejectsOtherRevisionsAndChangedDigest',()=>{
  const bytes=Buffer.from('export const generated=true;');
  const manifest={schemaVersion:1,revision:'b1b0f10952a59eb59f7358bd681a3cdc94d9b61c',
    sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.doesNotThrow(()=>release.assertReplayBundle(manifest,bytes));
  for(const revision of ['fbadd15785464e59747e697c11048bfbc6e4938f','99c265981ba98f1afd0e5fc822624a9a91822ad2','a'.repeat(40)])
    assert.throws(()=>release.assertReplayBundle({...manifest,revision},bytes));
  assert.throws(()=>release.assertReplayBundle(manifest,Buffer.from('changed')));
  assert.throws(()=>release.assertReplayBundle({...manifest,sha256:'0'.repeat(64)},bytes));
  assert.throws(()=>release.assertReplayBundle({...manifest,schemaVersion:2},bytes));
});

test('replayAssetsRefuseMissingChangedAndLinkedFont',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'replay-assets-')));mkdirSync(join(root,'assets'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'assets/invoice-noto-sans.ttf');
  assert.throws(()=>release.assertReplayAssets(root));
  writeFileSync(path,'changed');assert.throws(()=>release.assertReplayAssets(root));
  rmSync(path);symlinkSync(new URL('./fixtures/replay-font/invoice-noto-sans.ttf',import.meta.url),path);
  assert.throws(()=>release.assertReplayAssets(root));
  rmSync(path);writeFileSync(path,readFileSync(new URL('./fixtures/replay-font/invoice-noto-sans.ttf',import.meta.url)));
  assert.doesNotThrow(()=>release.assertReplayAssets(root));
});
