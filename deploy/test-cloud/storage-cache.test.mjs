import assert from 'node:assert/strict';
import test from 'node:test';
import {inspect} from 'node:util';
import {chmod,copyFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
// A verified cached archive is read-only input; rewriting it races other extractors.
test('parallel storage fixtures consume a verified read-only cached archive without rewriting it', {timeout:90000},async t=>{
 const names={'darwin-arm64':'darwin_arm64','linux-arm64':'linux_arm64','linux-x64':'linux_amd64'},archive='seaweed-4.48-'+names[process.platform+'-'+process.arch]+'.tar.gz';
 // Warm the existing verified cache using the real fixture before isolating this test's cache.
 const warm=await startBackupStorage();await warm.stop();
 const original=process.env.TMPDIR,root=await mkdtemp(join(tmpdir(),'cloud-archive-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'waitron-cloud-test-binaries');await mkdir(directory);const cached=join(directory,archive);
 await copyFile(join(tmpdir(),'waitron-cloud-test-binaries',archive),cached);await chmod(cached,0o444);
 process.env.TMPDIR=root;
 const results=await Promise.allSettled([startBackupStorage(),startBackupStorage()]);
 if(original===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=original;
 for(const [index,result] of results.entries())if(result.status==='rejected')t.diagnostic('storage startup '+index+' rejected: '+inspect(result.reason,{depth:8}));
 for(const result of results)if(result.status==='fulfilled')await result.value.stop();
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2,'both fixtures must use the existing read-only archive');
});

// A cold cache must also be shareable while two genuine verified downloads complete.
test('concurrent cold-cache downloads publish a complete archive before either fixture extracts it', {timeout:90000},async t=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const pins={'darwin-arm64':['darwin_arm64','faa194e72a346755dc4404288b0561eb3c260351702901d8363024d5099bdd7d'],'linux-arm64':['linux_arm64','557e92c38c5c7d180748eb8e2b2b45e426f8e5282a4caca8e098a90d09f03a07'],'linux-x64':['linux_amd64','4a7d108384d044d95212d1342cdda9533fa55842c1c9b41f606ca3c8a9561124']};
 const [name,digest]=pins[process.platform+'-'+process.arch],archive='seaweed-4.48-'+name+'.tar.gz',bytes=await readFile(join(tmpdir(),'waitron-cloud-test-binaries',archive));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);
 const root=await mkdtemp(join(tmpdir(),'cloud-cold-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=process.env.TMPDIR,fetchOriginal=globalThis.fetch;let requests=0,release;const bothDownloads=new Promise(resolve=>release=resolve);process.env.TMPDIR=root;
 globalThis.fetch=async url=>{assert.equal(url,'https://github.com/seaweedfs/seaweedfs/releases/download/4.48/'+name+'.tar.gz');requests++;if(requests===2)release();await bothDownloads;return new Response(bytes);};
 let results;try{results=await Promise.allSettled([startBackupStorage(),startBackupStorage()]);}
 finally{globalThis.fetch=fetchOriginal;if(original===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=original;}
 for(const [index,result] of results.entries())if(result.status==='rejected')t.diagnostic('storage startup '+index+' rejected: '+inspect(result.reason,{depth:8}));
 for(const result of results)if(result.status==='fulfilled')await result.value.stop();
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2,'both downloaded archives must extract and start the real store');assert.equal(requests,2);
 assert.equal(createHash('sha256').update(await readFile(join(root,'waitron-cloud-test-binaries',archive))).digest('hex'),digest);
});
