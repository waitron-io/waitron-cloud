import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';
import type {TrafficMapping} from '../src/traffic-mapping.ts';

// A reused device/inode pair must not let a replacement directory acknowledge signed bytes it never received.
test('exporter retains the exact retry when a replacement collector reuses its device and inode',async t=>{
 const root=await fs.promises.realpath(await fs.promises.mkdtemp(join(tmpdir(),'traffic-reused-inode-'))),directory=join(root,'collector');
 t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));
 await fs.promises.mkdir(directory,{mode:0o2750});await fs.promises.chmod(directory,0o2750);
 const mapping:TrafficMapping={country:'ES',environment:'test',cellId:randomUUID(),directory,writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId:mapping.cellId,gatewayId:randomUUID(),generation:1,processId:randomUUID(),sequence:1,
  from:'2026-11-01T00:00:00.000Z',until:'2026-11-01T00:00:01.000Z',complete:true,entries:[]};
 const envelope=signTrafficReport(report,generateKeyPairSync('ed25519').privateKey),spool=new TrafficSpool({directory:join(root,'spool'),maxBytes:32768});
 await spool.append(report,envelope,new Map());await spool.transfer(mapping);
 const old=await fs.promises.lstat(directory,{bigint:true});
 await fs.promises.rm(directory,{recursive:true});await delay(5);await fs.promises.mkdir(directory,{mode:0o2750});await fs.promises.chmod(directory,0o2750);
 const replacement=await fs.promises.lstat(directory,{bigint:true});assert.notEqual(replacement.birthtimeNs,old.birthtimeNs);
 t.diagnostic(`old dev/ino/birth=${old.dev}/${old.ino}/${old.birthtimeNs}; replacement=${replacement.dev}/${replacement.ino}/${replacement.birthtimeNs}`);
 const open=fs.promises.open,lstat=fs.promises.lstat;
 // Keep actual files, permissions and creation time. Simulate only the allocator reusing its old device/inode numbers.
 const reuse=<T extends {dev:bigint;ino:bigint}>(stat:T):T=>new Proxy(stat,{get(target,key,receiver){return key==='dev'?old.dev:key==='ino'?old.ino:Reflect.get(target,key,receiver);}});
 fs.promises.open=(async(path,...args:Parameters<typeof open> extends [unknown,...infer Rest]?Rest:never)=>{
  const handle=await open(path,...args);if(String(path)===directory){const stat=handle.stat.bind(handle);handle.stat=(async(options:any)=>reuse(await stat(options) as any)) as typeof handle.stat;}return handle;
 }) as typeof open;
 fs.promises.lstat=(async(path:fs.PathLike,...args:any[])=>{
  const stat=await (lstat as any)(path,...args);return String(path)===directory?reuse(stat):stat;
 }) as typeof lstat;
 syncBuiltinESMExports();
 try{
  await assert.rejects(new TrafficSpool({directory:join(root,'spool'),maxBytes:32768}).transfer(mapping),/^Error: traffic_spool_unavailable$/);
  assert.deepEqual(await spool.pending(),[envelope]);assert.equal((await spool.restore()).complete,false);
  assert.deepEqual(await fs.promises.readdir(directory),[],'no report was ever published into the replacement directory');
 }finally{fs.promises.open=open;fs.promises.lstat=lstat;syncBuiltinESMExports();}
});

// Old markers have no directory incarnation evidence and cannot turn deletion into an acknowledgement.
test('exporter refuses an older delivery marker while retaining its signed retry',async t=>{
 const root=await fs.promises.realpath(await fs.promises.mkdtemp(join(tmpdir(),'traffic-old-delivery-'))),directory=join(root,'collector'),privateDirectory=join(root,'spool');
 t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));await fs.promises.mkdir(directory,{mode:0o2750});await fs.promises.chmod(directory,0o2750);
 const mapping:TrafficMapping={country:'ES',environment:'test',cellId:randomUUID(),directory,writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId:mapping.cellId,gatewayId:randomUUID(),generation:1,processId:randomUUID(),sequence:1,
  from:'2026-11-01T00:00:00.000Z',until:'2026-11-01T00:00:01.000Z',complete:true,entries:[]};
 const envelope=signTrafficReport(report,generateKeyPairSync('ed25519').privateKey),spool=new TrafficSpool({directory:privateDirectory,maxBytes:32768});
 await spool.append(report,envelope,new Map());await spool.transfer(mapping);
 const marker=join(privateDirectory,'delivery.json'),saved=JSON.parse(await fs.promises.readFile(marker,'utf8'));
 saved.version=1;delete saved.birthtime;await fs.promises.writeFile(marker,JSON.stringify(saved));
 await fs.promises.unlink(join(directory,`${report.processId}.1.json`));
 await assert.rejects(spool.transfer(mapping),/^Error: traffic_spool_unavailable$/);
 assert.deepEqual(await spool.pending(),[envelope]);assert.equal((await spool.restore()).complete,false);
});

for(const fault of ['no-creation-time','changed-creation-time'] as const)test(`exporter refuses ${fault} before publishing or acknowledging bytes`,async t=>{
 const root=await fs.promises.realpath(await fs.promises.mkdtemp(join(tmpdir(),'traffic-directory-time-'))),directory=join(root,'collector'),privateDirectory=join(root,'spool');
 t.after(()=>fs.promises.rm(root,{recursive:true,force:true}));await fs.promises.mkdir(directory,{mode:0o2750});await fs.promises.chmod(directory,0o2750);
 const mapping:TrafficMapping={country:'ES',environment:'test',cellId:randomUUID(),directory,writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId:mapping.cellId,gatewayId:randomUUID(),generation:1,processId:randomUUID(),sequence:1,
  from:'2026-11-01T00:00:00.000Z',until:'2026-11-01T00:00:01.000Z',complete:true,entries:[]};
 const envelope=signTrafficReport(report,generateKeyPairSync('ed25519').privateKey),spool=new TrafficSpool({directory:privateDirectory,maxBytes:32768});
 await spool.append(report,envelope,new Map());
 const open=fs.promises.open,lstat=fs.promises.lstat;
 const changed=(stat:any)=>new Proxy(stat,{get(target,key,receiver){return key==='birthtimeNs'?(fault==='no-creation-time'?0n:target.birthtimeNs+1n):Reflect.get(target,key,receiver);}});
 fs.promises.open=(async(path:fs.PathLike,...args:any[])=>{
  const handle=await (open as any)(path,...args);if(String(path)===directory&&fault==='no-creation-time'){const stat=handle.stat.bind(handle);handle.stat=async(options:any)=>changed(await stat(options));}return handle;
 }) as typeof open;
 fs.promises.lstat=(async(path:fs.PathLike,...args:any[])=>{
  const stat=await (lstat as any)(path,...args);return String(path)===directory?changed(stat):stat;
 }) as typeof lstat;
 syncBuiltinESMExports();
 try{
  await assert.rejects(spool.transfer(mapping),/^Error: traffic_spool_unavailable$/);
  assert.deepEqual(await spool.pending(),[envelope]);assert.deepEqual(await fs.promises.readdir(directory),[]);
 }finally{fs.promises.open=open;fs.promises.lstat=lstat;syncBuiltinESMExports();}
});
