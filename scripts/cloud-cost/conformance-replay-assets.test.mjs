import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as release from './replay-release.mjs';

test('replayPreparationCarriesPinnedFont',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'replay-copy-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'source'),runtime=join(root,'runtime');
 mkdirSync(join(source,'apps/server/src/assets'),{recursive:true});mkdirSync(runtime);
 const original=readFileSync(new URL('./fixtures/replay-font/invoice-noto-sans.ttf',import.meta.url));
 writeFileSync(join(source,'apps/server/src/assets/invoice-noto-sans.ttf'),original);
 assert.equal(typeof release.copyReplayAssets,'function');
 release.copyReplayAssets(source,runtime);
 assert.doesNotThrow(()=>release.assertReplayAssets(runtime));
 assert.deepEqual(readFileSync(join(runtime,'assets/invoice-noto-sans.ttf')),original);
});

test('assetPreparationRefusesMissingChangedAndLinkedSource',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'replay-source-assets-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'source'),runtime=join(root,'runtime');
 mkdirSync(join(source,'apps/server/src/assets'),{recursive:true});mkdirSync(runtime);
 const path=join(source,'apps/server/src/assets/invoice-noto-sans.ttf');
 assert.equal(typeof release.copyReplayAssets,'function');
 assert.throws(()=>release.copyReplayAssets(source,runtime));
 writeFileSync(path,'changed');assert.throws(()=>release.copyReplayAssets(source,runtime));
 rmSync(path);symlinkSync(new URL('./fixtures/replay-font/invoice-noto-sans.ttf',import.meta.url),path);
 assert.throws(()=>release.copyReplayAssets(source,runtime));
});

test('preparedRuntimeCopiesItsVerifiedFontIntoTheOwnerPeer',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'replay-peer-assets-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const runtime=join(root,'runtime'),peer=join(root,'peer');
 mkdirSync(join(runtime,'assets'),{recursive:true});mkdirSync(peer);
 const path=join(runtime,'assets/invoice-noto-sans.ttf');
 writeFileSync(path,readFileSync(new URL('./fixtures/replay-font/invoice-noto-sans.ttf',import.meta.url)));
 assert.equal(typeof release.copyPreparedReplayAssets,'function');
 release.copyPreparedReplayAssets(runtime,peer);
 assert.doesNotThrow(()=>release.assertReplayAssets(peer));
 writeFileSync(path,'changed');
 const other=join(root,'other');mkdirSync(other);
 assert.throws(()=>release.copyPreparedReplayAssets(runtime,other));
});
