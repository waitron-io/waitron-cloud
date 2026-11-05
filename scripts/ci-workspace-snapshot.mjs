import assert from 'node:assert/strict';
import {posix} from 'node:path';
import {sourceDependencies} from './ci-scope.mjs';

export function loadWorkspaceAtRevision(revision, git) {
  assert.match(revision, /^(?!0{40}$)[a-f0-9]{40}$/, 'Invalid workspace revision');
  assert.equal(git('rev-parse','--verify',`${revision}^{commit}`).trim(),revision,'Workspace revision must resolve exactly');
  const entries=git('ls-tree','-rz','--full-tree',revision).split('\0');
  assert.equal(entries.pop(),'','Incomplete workspace inventory');
  const files=new Map();
  for (const entry of entries) {
    const match=entry.match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/);
    assert.ok(match,'Malformed workspace inventory');
    const [,mode,type,id,path]=match;
    assert.ok(!files.has(path),'Duplicate workspace path');
    assert.ok(!/(?:^|\/)\.gitattributes$/.test(path),'Checkout attributes require full work');
    files.set(path,{mode,type,id});
  }
  const inputs=[...files].filter(([path])=>path==='pnpm-workspace.yaml' || /^(?:packages|apps)\/[^/]+\/(?:package\.json|.*\.[cm]?[jt]sx?)$/.test(path));
  const blobs=git.readBlobs?.([...new Set(inputs.map(([,file])=>file.id))]);
  const read=path=>{
    const file=files.get(path);
    assert.ok(file?.type==='blob' && ['100644','100755'].includes(file.mode),`Nonregular or missing workspace input: ${path}`);
    if (!git.readBlobs) return git('show',`${revision}:${path}`);
    const value=blobs?.get(file.id);
    assert.equal(typeof value,'string',`Missing workspace blob: ${path}`);
    return value;
  };
  assert.match(read('pnpm-workspace.yaml'),/^packages:\s*\n  - 'packages\/\*'\s*\n  - 'apps\/\*'\s*$/,'Unsupported workspace discovery policy');
  const packages=[...files.keys()].filter(path=>/^(?:packages|apps)\/[^/]+\/package\.json$/.test(path))
    .map(path=>({...JSON.parse(read(path)),directory:posix.dirname(path)}));
  assert.ok(packages.length && new Set(packages.map(pkg=>pkg.name)).size===packages.length,'Invalid workspace members');
  const testFilesByPackage={};
  for (const pkg of packages) {
    assert.match(pkg.name,/^@waitron-cloud\/[a-z-]+$/,'Invalid workspace package name');
    const sources=[];
    testFilesByPackage[pkg.name]=[];
    for (const [path,file] of files) {
      if (!path.startsWith(`${pkg.directory}/`)) continue;
      assert.ok(file.type==='blob' && ['100644','100755'].includes(file.mode),`Nonregular workspace input: ${path}`);
      const parts=path.split('/').slice(2);
      assert.ok(!parts.includes('node_modules') && !parts.includes('.git'),'Tracked dependency override');
      if (parts.some(part=>['dist','coverage'].includes(part))) continue;
      if (/\.[cm]?[jt]sx?$/.test(path)) sources.push({path,source:read(path)});
      if (posix.dirname(path)===`${pkg.directory}/test` && path.endsWith('.test.ts')) testFilesByPackage[pkg.name].push(path);
    }
    pkg.pathDependencies=sourceDependencies(pkg,packages,sources,'/');
  }
  return {revision,packages,testFilesByPackage};
}
