import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdirSync,copyFileSync,constants} from 'node:fs';
import {join} from 'node:path';

export const REPLAY_REVISION='b1b0f10952a59eb59f7358bd681a3cdc94d9b61c';
export const REPLAY_INVOICE_FONT_SHA256='bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d';
const fail=()=>{throw Error('Invalid cloud cost replay release');};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertReplayBundle(manifest,bytes) {
  if(manifest.schemaVersion!==1||manifest.revision!==REPLAY_REVISION||manifest.sha256!==digest(bytes))fail();
}
function assertFont(path){
  const stat=lstatSync(path);
  if(realpathSync(path)!==path||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1
    ||digest(readFileSync(path))!==REPLAY_INVOICE_FONT_SHA256)fail();
}
export function assertReplayAssets(root){assertFont(join(root,'assets/invoice-noto-sans.ttf'));}
export function copyReplayAssets(sourceRoot,runtimeRoot){
  const source=join(sourceRoot,'apps/server/src/assets/invoice-noto-sans.ttf');
  assertFont(source);
  mkdirSync(join(runtimeRoot,'assets'));
  copyFileSync(source,join(runtimeRoot,'assets/invoice-noto-sans.ttf'),constants.COPYFILE_EXCL);
  assertReplayAssets(runtimeRoot);
}

export function copyPreparedReplayAssets(runtimeRoot,targetRoot){
  assertReplayAssets(runtimeRoot);
  mkdirSync(join(targetRoot,'assets'));
  copyFileSync(join(runtimeRoot,'assets/invoice-noto-sans.ttf'),join(targetRoot,'assets/invoice-noto-sans.ttf'),constants.COPYFILE_EXCL);
  assertReplayAssets(targetRoot);
}
