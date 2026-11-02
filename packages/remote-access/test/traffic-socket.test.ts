import assert from 'node:assert/strict';
import {createServer,type Socket} from 'node:net';
import {chmod,mkdtemp,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
const api=await import(new URL('../src/traffic-socket.ts',import.meta.url).href).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return undefined;});
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},handle:(socket:Socket)=>void){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'traffic-socket-'))),path=join(directory,'stats.sock'),sockets=new Set<Socket>();
 const server=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));handle(socket);});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});await chmod(path,0o600);
 t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});
 return {path,directory,sockets};
}
function read(path:string){assert.equal(typeof api?.readTrafficSocket,'function','bounded private HAProxy socket reader must exist');return api!.readTrafficSocket(path);}

test('private socket sends exactly show stat and retains split response bytes',async t=>{
 let request='';const f=await fixture(t,socket=>{socket.on('data',data=>{request+=data.toString();if(request==='show stat\n'){socket.write('# pxname,');setImmediate(()=>socket.end('svname,bin,bout\nvenue,BACKEND,10,25\n'));}});});
 let response:string|undefined;await assert.doesNotReject(async()=>{response=await read(f.path);});assert.equal(response,'# pxname,svname,bin,bout\nvenue,BACKEND,10,25\n');assert.equal(request,'show stat\n');
});
test('private socket refuses oversized output and closes its connection',async t=>{
 const f=await fixture(t,socket=>socket.on('data',()=>socket.end(Buffer.alloc(1048577,65))));
 await assert.rejects(read(f.path),/^Error: traffic_socket_unavailable$/);
});
test('private socket permits the exact response cap without rounding or truncation',async t=>{
 const f=await fixture(t,socket=>socket.on('data',()=>socket.end(Buffer.alloc(1048576,65))));
 assert.equal(Buffer.byteLength(await read(f.path)),1048576);
});
test('private socket rejects invalid UTF-8 rather than repairing counter bytes',async t=>{
 const f=await fixture(t,socket=>socket.on('data',()=>socket.end(Buffer.from([0xff]))));await assert.rejects(read(f.path),/^Error: traffic_socket_unavailable$/);
});
test('private socket bounds a peer which stays open without completing its response',async t=>{
 const f=await fixture(t,()=>{}),before=performance.now();await assert.rejects(read(f.path),/^Error: traffic_socket_unavailable$/);assert.ok(performance.now()-before<3000,'socket must refuse within its one-second deadline plus scheduling margin');
});
test('socket deadline is total time even when the peer keeps sending partial output',async t=>{
 const f=await fixture(t,socket=>{const timer=setInterval(()=>socket.write('x'),30);socket.once('close',()=>clearInterval(timer));}),before=performance.now();
 const outcome=await Promise.race([read(f.path).then(()=> 'accepted',()=> 'refused'),new Promise<string>(resolve=>setTimeout(()=>resolve('hung'),3000))]);
 assert.equal(outcome,'refused','partial output cannot keep the reader pending');assert.ok(performance.now()-before<3000,'active output must not extend the deadline');
});
for(const fault of ['mode','symlink','parent-symlink','regular','missing','relative','traversal'])test(`private socket refuses ${fault}`,async t=>{
 let connections=0;const f=await fixture(t,()=>{connections++;});let path=f.path;
 if(fault==='mode')await chmod(path,0o666);
 if(fault==='symlink'){path=join(f.directory,'alias.sock');await symlink(f.path,path);}
 if(fault==='parent-symlink'){const alias=join(f.directory,'alias');await symlink(f.directory,alias);path=join(alias,'stats.sock');}
 if(fault==='regular'){path=join(f.directory,'file.sock');await writeFile(path,'private',{mode:0o600});}
 if(fault==='missing')path=join(f.directory,'missing.sock');
 if(fault==='relative')path='relative.sock';
 if(fault==='traversal')path=join(f.directory,'nested')+'/../stats.sock';
 await assert.rejects(read(path),/^Error: traffic_socket_unavailable$/);assert.equal(connections,0);
});

test('private socket refuses a path whose access mode changes during the response',async t=>{
 let path='';const f=await fixture(t,socket=>socket.on('data',()=>{void chmod(path,0o666).then(()=>socket.end('valid'));}));path=f.path;
 await assert.rejects(read(path),/^Error: traffic_socket_unavailable$/);
});

test('private socket refuses a replacement socket even with the same owner and mode',async t=>{
 const {rename}=await import('node:fs/promises');let path='';
 const f=await fixture(t,socket=>socket.on('data',()=>{void (async()=>{
  await rename(path,path+'.old');const replacement=createServer();await new Promise<void>(resolve=>replacement.listen(path,resolve));await chmod(path,0o600);
  t.after(()=>new Promise<void>(resolve=>replacement.close(()=>resolve())));socket.end('valid');
 })();}));path=f.path;
 await assert.rejects(read(path),/^Error: traffic_socket_unavailable$/);
});
