import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {createServer,request,Agent} from 'node:http';
import {connect} from 'node:net';
import type {Pool} from 'pg';
import {EmailOutbox} from '@waitron-cloud/registration';
import {startAccountServer} from '../src/server.ts';
import type {RequestSnapshot} from '../src/request-metrics.ts';

const options=()=>({pool:{query(){throw Error('Unexpected database query');},connect(){throw Error('Unexpected database connect');}} as unknown as Pool,
 outbox:new EmailOutbox({activeKeyId:'test',keys:{test:'11'.repeat(32)}}),
 config:{portalOrigin:'http://localhost',production:false,rateKey:'22'.repeat(32),trustedProxyIps:[]},
 host:'127.0.0.1',port:0,localMetrics:{host:'127.0.0.1',port:0}});
const port=(server:import('node:http').Server)=>{const address=server.address();assert(address&&typeof address!=='string');return address.port;};
const get=(server:import('node:http').Server,path='/metrics')=>fetch(`http://127.0.0.1:${port(server)}${path}`);
async function send(server:import('node:http').Server,path:string,host='localhost',agent?:Agent){
 return await new Promise<number>((resolve,reject)=>{const req=request({host:'127.0.0.1',port:port(server),path,headers:{host},agent},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end();});
}
async function snapshot(server:import('node:http').Server):Promise<RequestSnapshot>{const response=await get(server);assert.equal(response.headers.get('cache-control'),'no-store');return await response.json() as RequestSnapshot;}

test('real responses count early refusals, portal failures and keep-alive requests without counting scrapes',async t=>{
 const assets=new Map([['/index.html',{body:Buffer.from('portal'),contentType:'text/html'}]]);
 const running=await startAccountServer({...options(),portalAssets:assets});
 t.after(()=>running.close());
 const metrics=running.metricsServer!;assert(metrics,'local metrics listener must be enabled');
 const agent=new Agent({keepAlive:true,maxSockets:1});
 try{
  assert.equal(await send(running.server,'/signup','localhost',agent),200);
  assert.equal(await send(running.server,'/api/health/live','localhost',agent),200);
  assert.equal(await send(running.server,'/api/health/live','localhost',agent),200);
  assert.equal(await send(running.server,'/signup','private.invalid'),403);
  assets.get=()=>{throw Error('private lookup failure');};
  assert.equal(await send(running.server,'/signup'),503);
  const first=await snapshot(metrics);
  assert.deepEqual(first.series.map(({group,outcome,total,count})=>({group,outcome,total,count})),[
   {group:'portal',outcome:'success',total:1,count:1},{group:'health',outcome:'success',total:2,count:2},
   {group:'portal',outcome:'refused',total:1,count:1},{group:'portal',outcome:'server_error',total:1,count:1},
  ]);
  assert.deepEqual(await snapshot(metrics),first);
  assert.equal((await get(metrics,'/private')).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${port(metrics)}/metrics`,{method:'POST'})).status,404);
 }finally{agent.destroy();await running.close();}
 assert.equal(metrics.listening,false);assert.equal(running.server.listening,false);
});

test('admission 503 counts before the earlier readiness request finishes',async()=>{
 let release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(resolve=>{entered=resolve;});
 const pool={async connect(){entered();await new Promise<void>(resolve=>{release=resolve;});throw Error('database unavailable');}} as unknown as Pool;
 const running=await startAccountServer({...options(),pool});const metrics=running.metricsServer!;
 try{
  const slow=send(running.server,'/api/health/ready');await waiting;
  assert.equal(await send(running.server,'/api/health/ready'),503);
  assert.equal((await snapshot(metrics)).series.find(row=>row.outcome==='server_error')?.total,1);
  release();assert.equal(await slow,503);
  assert.equal((await snapshot(metrics)).series.find(row=>row.outcome==='server_error')?.total,2);
 }finally{release?.();await running.close();}
});

test('raw parser errors and header timeouts have counts without invented timings',{timeout:10000},async()=>{
 const running=await startAccountServer(options());const metrics=running.metricsServer!;
 async function raw(text:string){const socket=connect(port(running.server),'127.0.0.1');await once(socket,'connect');socket.end(text);let reply='';for await(const part of socket)reply+=part;return reply;}
 try{
  assert.match(await raw('BAD\r\n\r\n'),/400 Bad Request/);
  running.server.headersTimeout=40;running.server.requestTimeout=40;
  const socket=connect(port(running.server),'127.0.0.1');await once(socket,'connect');socket.write('GET /api/health/live HTTP/1.1\r\nHost: localhost\r\n');
  let reply='';for await(const part of socket)reply+=part;assert.match(reply,/408 Request Timeout/);
  const value=await snapshot(metrics);
  assert.deepEqual(value.series.map(({group,outcome,total,count})=>({group,outcome,total,count})),[
   {group:'parser',outcome:'refused',total:1,count:0},{group:'parser',outcome:'timed_out',total:1,count:0},
  ]);
  assert.doesNotMatch(JSON.stringify(value),/localhost|BAD/);
 }finally{await running.close();}
});

test('parsed body timeout settles once and a disconnected unfinished response is excluded',{timeout:10000},async()=>{
 let entered!:()=>void,release!:()=>void,finished!:()=>void;
 let admission=new Promise<void>(resolve=>{entered=resolve;});
 let completion=new Promise<void>(resolve=>{finished=resolve;});
 const pool={async connect(){entered();await new Promise<void>(resolve=>{release=resolve;});finished();throw Error('database unavailable');}} as unknown as Pool;
 const running=await startAccountServer({...options(),pool});const metrics=running.metricsServer!;
 running.server.requestTimeout=40;running.server.headersTimeout=40;
 async function pending(){const socket=connect(port(running.server),'127.0.0.1');await once(socket,'connect');socket.write('POST /api/account/signup/request HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{');await admission;return socket;}
 try{
  const timed=await pending();let reply='';for await(const part of timed)reply+=part;
  assert.match(reply,/408 Request Timeout/);release();await completion;
  const first=await snapshot(metrics);
  assert.deepEqual(first.series.map(({group,outcome,total,count})=>({group,outcome,total,count})),[{group:'account',outcome:'timed_out',total:1,count:1}]);
  admission=new Promise<void>(resolve=>{entered=resolve;});completion=new Promise<void>(resolve=>{finished=resolve;});
  const connection=once(running.server,'connection');
  const abandoned=await pending();const [peer]=await connection;
  const closed=once(peer,'close');abandoned.destroy();await closed;release();await completion;
  assert.deepEqual(await snapshot(metrics),first);
 }finally{release?.();await running.close();}
});

test('disabled metrics open no listener and partial startup failure closes the account socket',async()=>{
 await assert.rejects(startAccountServer({...options(),config:{...options().config,production:true,portalOrigin:'https://example.invalid'}})
  .then(async running=>{await running.close();return running;}),/Local metrics are unavailable in production/);
 const disabled=await startAccountServer({...options(),localMetrics:undefined});
 assert.equal(disabled.metricsServer,undefined);await disabled.close();
 const occupied=createServer();await new Promise<void>(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(startAccountServer({...options(),localMetrics:{host:'127.0.0.1',port:port(occupied)}}).then(async running=>{await running.close();return running;}),{code:'EADDRINUSE'});}
 finally{await new Promise<void>(resolve=>occupied.close(()=>resolve()));}
});
