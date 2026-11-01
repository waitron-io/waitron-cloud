import assert from 'node:assert/strict';
import {createServer,type Socket} from 'node:net';
import {once} from 'node:events';
import {test} from 'node:test';
import {Pool} from 'pg';
import * as evidence from './consent-database-evidence.ts';

for(const brokenReporter of [false,true])test(`a refused diagnostic connection retains the original consent failure with reporter failure ${brokenReporter}`,async()=>{
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=(server.address() as {port:number}).port;
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 const pool=new Pool({host:'127.0.0.1',port,user:'private-user',password:'private-password',database:'private-database'});
 const original=new Error('private-original'),reports:string[]=[];
 try{
  assert.equal(typeof evidence.failConsentDatabaseWait,'function','consent failures need independent bounded database evidence');
  await assert.rejects(evidence.failConsentDatabaseWait(pool,'private-schema',original,value=>{reports.push(value);if(brokenReporter)throw new Error('private-reporter');}),error=>error===original);
  assert.deepEqual(reports.map(value=>JSON.parse(value)),[{unavailable:true}]);
  assert.equal(reports.join('').includes('private'),false);
 }finally{await pool.end();}
});

test('an unanswered database handshake ends its own connection and retains the consent failure',async()=>{
 const sockets=new Set<Socket>();let handshakes=0;
 const server=createServer(socket=>{sockets.add(socket);socket.on('data',()=>{handshakes++;});socket.on('close',()=>sockets.delete(socket));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const pool=new Pool({host:'127.0.0.1',port:(server.address() as {port:number}).port,user:'private-user',database:'private-database',ssl:false});
 const original=new Error('original');let report='';
 try{
  assert.equal(typeof evidence.failConsentDatabaseWait,'function','consent failures need independent bounded database evidence');
  const started=performance.now();
  await assert.rejects(evidence.failConsentDatabaseWait(pool,'private-schema',original,value=>{report=value;}),error=>error===original);
  assert.ok(performance.now()-started<1500,'diagnostics must end independently of a stalled PostgreSQL peer');
  assert.deepEqual(JSON.parse(report),{unavailable:true});assert.ok(handshakes>0);
  for(let n=0;n<100&&sockets.size;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(sockets.size,0,'the diagnostic connection must close');
 }finally{await pool.end();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('a connected database that never answers the snapshot query cannot retain the diagnostic connection',async()=>{
 const sockets=new Set<Socket>();let queries=0;
 const server=createServer(socket=>{
  sockets.add(socket);let startup=true;
  socket.on('data',bytes=>{
   if(startup){startup=false;socket.write(Buffer.from([82,0,0,0,8,0,0,0,0,90,0,0,0,5,73]));}
   else if(bytes[0]===81||bytes[0]===80)queries++;
  });
  socket.on('close',()=>sockets.delete(socket));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const pool=new Pool({host:'127.0.0.1',port:(server.address() as {port:number}).port,user:'private-user',database:'private-database',ssl:false});
 const original=new Error('original');let report='';
 try{
  const started=performance.now();
  await assert.rejects(evidence.failConsentDatabaseWait(pool,'private-schema',original,value=>{report=value;}),error=>error===original);
  assert.ok(queries>0,'a connected diagnostic must actually request its database snapshot');
  assert.ok(performance.now()-started<1500,'the budget must cover the query as well as connection setup');
  assert.deepEqual(JSON.parse(report),{unavailable:true});
  for(let n=0;n<100&&sockets.size;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(sockets.size,0,'the connected diagnostic must close');
 }finally{await pool.end();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('the consent diagnostic query budget expires at 250 ms rather than one second',async t=>{
 const sockets=new Set<Socket>();let entered!:()=>void;
 const queryEntered=new Promise<void>(resolve=>{entered=resolve;});
 const server=createServer(socket=>{
  sockets.add(socket);let startup=true;
  socket.on('data',bytes=>{
   if(startup){startup=false;socket.write(Buffer.from([82,0,0,0,8,0,0,0,0,90,0,0,0,5,73]));}
   else if(bytes[0]===81||bytes[0]===80)entered();
  });
  socket.on('close',()=>sockets.delete(socket));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const pool=new Pool({host:'127.0.0.1',port:(server.address() as {port:number}).port,user:'test',database:'test',ssl:false});
 const original=new Error('original'),reports:string[]=[];
 t.mock.timers.enable({apis:['setTimeout']});
 const failed=assert.rejects(evidence.failConsentDatabaseWait(pool,'schema',original,value=>reports.push(value)),error=>error===original);
 void failed.catch(()=>{});
 try{
  await queryEntered;
  t.mock.timers.tick(249);await new Promise<void>(resolve=>setImmediate(resolve));assert.deepEqual(reports,[]);
  t.mock.timers.tick(1);
  for(let n=0;n<20&&!reports.length;n++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(reports.length,1);assert.deepEqual(JSON.parse(reports[0]!),{unavailable:true});
  await failed;
 }finally{
  t.mock.timers.tick(2000);
  try{await failed;}finally{
   await pool.end();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
 }
});

test('a completed snapshot does not wait for the database peer to acknowledge disconnect',async()=>{
 const sockets=new Set<Socket>();let completed=false,disconnect=false;
 const server=createServer({allowHalfOpen:true},socket=>{
  sockets.add(socket);let startup=true;
  socket.on('data',bytes=>{
   if(startup){startup=false;socket.write(Buffer.from([82,0,0,0,8,0,0,0,0,90,0,0,0,5,73]));}
   else if(bytes[0]===80){
    socket.write(Buffer.from([49,0,0,0,4,50,0,0,0,4,110,0,0,0,4,67,0,0,0,13,83,69,76,69,67,84,32,48,0,90,0,0,0,5,73]));completed=true;
   }else if(bytes[0]===88)disconnect=true;
  });
  socket.on('end',()=>{disconnect=true;});socket.on('close',()=>sockets.delete(socket));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const pool=new Pool({host:'127.0.0.1',port:(server.address() as {port:number}).port,user:'test',database:'test',ssl:false});
 const original=new Error('original');let returned=false;
 const failed=assert.rejects(evidence.failConsentDatabaseWait(pool,'schema',original,()=>{returned=true;}),error=>error===original);void failed.catch(()=>{});
 try{
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(completed,true,'the peer must complete the snapshot before withholding disconnect');
  assert.equal(disconnect,true,'the diagnostic must initiate disconnect');
  assert.equal(returned,true,'disconnect acknowledgement cannot hold the failed consent check');
 }finally{
  for(const socket of sockets)socket.destroy();
  try{await failed;}finally{await pool.end();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 }
});
