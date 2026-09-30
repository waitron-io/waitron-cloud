import assert from 'node:assert/strict';
import {test} from 'node:test';
import {request} from 'node:http';
import {startAccountServer} from '../src/server.ts';
import {database} from './fixtures.ts';

test('normal HTTP startup exposes no relay grant or send capability',async()=>{
 const db=await database();
 const running=await startAccountServer({pool:db.pool,outbox:db.outbox,config:{portalOrigin:'http://localhost',production:false,rateKey:db.rateKey,trustedProxyIps:[]},port:0});
 try{
  const address=running.server.address();assert.ok(address&&typeof address!=='string');
  for(const path of ['/v1/installations/email/submit','/v1/installations/email/status','/v1/installations/email/cancel','/api/account/relay/grants']){
   const response=await new Promise<{status:number|undefined}>((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:address.port,path,method:'POST',headers:{host:'localhost',origin:'http://localhost','content-type':'application/json'}},res=>{
     res.resume();res.once('end',()=>resolve({status:res.statusCode}));res.once('error',reject);
    });req.once('error',reject);req.end('{}');
   });
   assert.equal(response.status,404,path);
  }
  assert.equal((await db.pool.query('SELECT count(*) FROM relay_grants')).rows[0].count,'0');
  assert.equal((await db.pool.query('SELECT count(*) FROM email_outbox')).rows[0].count,'0');
 }finally{await running.close();await db.close();}
});
