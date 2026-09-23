import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type IncomingMessage, type ClientRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { EmailOutbox } from '@waitron-cloud/registration';
import { startAccountServer } from '../../src/server.ts';
import { loadPortalAssets, portalResponse } from '../../src/portal.ts';
const pool = new Pool();
let running: Awaited<ReturnType<typeof startAccountServer>> | undefined;
const requests: ClientRequest[] = [];
const directory = await mkdtemp(join(tmpdir(), 'cloud-portal-memory-'));
try {
  const size = 4 * 1024 * 1024;
  await writeFile(join(directory, 'index.html'), '<title>Cloud</title>');
  await writeFile(join(directory, 'app.css'), 'body{}');
  await writeFile(join(directory, 'app.js'), Buffer.alloc(size, 97));
  const assets = await loadPortalAssets(directory);
  global.gc!(); const before = process.memoryUsage().arrayBuffers;
  const responses = Array.from({length: 24}, () => portalResponse(new Request('http://localhost/app.js'), assets));
  global.gc!(); const allocated = process.memoryUsage().arrayBuffers - before;
  const bytes = await responses[0]!.arrayBuffer();
  const statuses = responses.map(r => r.status);
  running = await startAccountServer({pool, outbox: new EmailOutbox({activeKeyId:'test',keys:{test:'a'.repeat(64)}}),
    config:{portalOrigin:'http://localhost',production:false,rateKey:'b'.repeat(64),trustedProxyIps:[]}, port:0, portalAssets:assets});
  const port = (running.server.address() as {port:number}).port;
  global.gc!(); const networkBefore = process.memoryUsage().arrayBuffers;
  const readers = await Promise.all(Array.from({length:32},()=>new Promise<IncomingMessage>((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,path:'/app.js',headers:{host:'localhost'}},res=>{res.pause();resolve(res);});
    requests.push(req);req.on('error',reject);req.end();
  })));
  await delay(150);global.gc!();const networkAllocated=process.memoryUsage().arrayBuffers-networkBefore;
  const lengths=await Promise.all(readers.map(res=>new Promise<number>((resolve,reject)=>{
    let length=0;res.on('data',chunk=>{length+=chunk.length;});res.on('end',()=>resolve(length));res.on('error',reject);res.resume();
  })));
  console.log(JSON.stringify({allocated,networkAllocated,lengths,size:bytes.byteLength,first:new Uint8Array(bytes)[0],statuses}));
  await Promise.all(responses.slice(1).map(r => r.body?.cancel()));
} finally { requests.forEach(req=>req.destroy()); await running?.close(); await pool.end(); await rm(directory, {recursive: true, force: true}); }
