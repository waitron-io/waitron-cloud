import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {Route53Client} from '@aws-sdk/client-route-53';
import {createRoute53DnsProvider} from '../src/route53-dns.ts';

const name='_acme-challenge.staff-v-11111111-1111-4111-8111-111111111111.test.waitron.io';
const token='A'.repeat(43);
async function fixture(maxAttempts=1){
 const requests:{method:string;path:string;body:string}[]=[],records=new Map<string,string>();let pending=0,denied=false,deniedGet=false,hang=false,hangGet=false,missingId=false;const errors:unknown[]=[],observers:(()=>void)[]=[];
 const server=createServer(async(req,res)=>{
  try{let body='';for await(const part of req)body+=part;
  requests.push({method:req.method!,path:req.url!,body});for(const notify of observers.splice(0))notify();if(hang||(hangGet&&req.method==='GET'))return;res.setHeader('Content-Type','text/xml');
  const error=(code:string)=>{res.statusCode=400;res.end(`<ErrorResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><Error><Code>${code}</Code><Message>Refused</Message></Error></ErrorResponse>`);};
  if(denied||(deniedGet&&req.method==='GET')){error('AccessDenied');return;}
  if(req.method==='GET'){
   assert.equal(req.url,'/2013-04-01/change/C1');
   res.end(`<GetChangeResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><ChangeInfo><Id>/change/C1</Id><Status>${pending-->0?'PENDING':'INSYNC'}</Status><SubmittedAt>2026-11-06T00:00:00Z</SubmittedAt></ChangeInfo></GetChangeResponse>`);return;
  }
  assert.equal(req.method,'POST');assert.equal(req.url,'/2013-04-01/hostedzone/Z123/rrset');
  assert.match(body,/<Type>TXT<\/Type>/);assert.match(body,/<TTL>60<\/TTL>/);
  const recordName=body.match(/<Name>([^<]+)<\/Name>/)![1]!,value=body.match(/<Value>([^<]+)<\/Value>/)![1]!.replaceAll('&quot;','"');
  assert.match(value,/^"[A-Za-z0-9_-]{43}"$/);
  if(body.includes('<Action>UPSERT</Action>'))records.set(recordName,value);
  else{assert.match(body,/<Action>DELETE<\/Action>/);if(records.get(recordName)!==value){error('InvalidChangeBatch');return;}records.delete(recordName);}
  res.end('<ChangeResourceRecordSetsResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><ChangeInfo>'+(missingId?'':'<Id>/change/C1</Id>')+'<Status>PENDING</Status><SubmittedAt>2026-11-06T00:00:00Z</SubmittedAt></ChangeInfo></ChangeResourceRecordSetsResponse>');
  }catch(error){errors.push(error);res.statusCode=500;res.end('<ErrorResponse><Error><Code>InternalFailure</Code></Error></ErrorResponse>');}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 const client=new Route53Client({region:'us-east-1',endpoint:`http://127.0.0.1:${address.port}`,credentials:{accessKeyId:'test',secretAccessKey:'test'},maxAttempts});
 const dns=createRoute53DnsProvider({zoneId:'Z123',suffix:'test.waitron.io'},client);
 return {dns,requests,records,hang(){hang=true;},hangGet(){hangGet=true;},denyGet(){deniedGet=true;},missingId(){missingId=true;},received(count=1){return new Promise<void>(resolve=>{const check=()=>{if(requests.length>=count)resolve();else observers.push(check);};check();});},setPending(){pending=1;},deny(){denied=true;},async close(){client.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));assert.deepEqual(errors,[]);}};
}
test('publishes only the challenge TXT value, waits for authoritative propagation and removes it exactly',async()=>{
 const f=await fixture();try{
  f.setPending();await f.dns.present(name,token);assert.equal(f.records.get(name),'"'+token+'"');
  assert.deepEqual(f.requests.map(r=>r.method),['POST','GET','GET']);
  await f.dns.remove(name,token);assert.equal(f.records.size,0);assert.deepEqual(f.requests.map(r=>r.method),['POST','GET','GET','POST']);assert.match(f.requests.at(-1)!.body,/<Action>DELETE<\/Action>/);
 }finally{await f.close();}
});
test('refuses unrelated names and malformed challenge values before any AWS request',async()=>{
 const f=await fixture();try{
  for(const invalid of ['test.waitron.io','www.xxxxxxxxxxxxbox.test.waitron.io','_acme-challenge.'+['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(45),'test','waitron','io'].join('.'),'_acme-challenge.test.waitron.io','_acme-challenge.other.waitron.io','_acme-challenge.box.test.waitron.io.attacker.test','_acme-challenge.*.test.waitron.io','_acme-challenge.foo..test.waitron.io','_acme-challenge.foo.TEST.waitron.io']){
   await assert.rejects(f.dns.present(invalid,token),/invalid_dns_challenge/);await assert.rejects(f.dns.remove(invalid,token),/invalid_dns_challenge/);
  }
  for(const invalid of ['',token+'"',token+'\n',token.slice(1)])await assert.rejects(f.dns.present(name,invalid),/invalid_dns_challenge/);
  for(const config of [{zoneId:'',suffix:'test.waitron.io'},{zoneId:'Z123/rrset',suffix:'test.waitron.io'},{zoneId:'Z123',suffix:'*.test.waitron.io'}])assert.throws(()=>createRoute53DnsProvider(config),/invalid_route53_configuration/);
  assert.equal(f.requests.length,0);
 }finally{await f.close();}
});
test('old cleanup cannot delete a different newer challenge and service refusals remain failures',async t=>{
 const warnings=t.mock.method(console,'error',()=>{});
 const f=await fixture();try{
  await f.dns.present(name,token);f.records.set(name,'"'+'B'.repeat(43)+'"');
  await assert.rejects(f.dns.remove(name,token),{name:'InvalidChangeBatch'});assert.equal(f.records.get(name),'"'+'B'.repeat(43)+'"');
  f.deny();const before=f.requests.length;await assert.rejects(f.dns.present(name,token),{name:'AccessDenied'});assert.equal(f.requests.length,before+1);assert.deepEqual(warnings.mock.calls.map(c=>c.arguments),[['remote.dns_cleanup_failed']]);
 }finally{await f.close();}
});

test('hung AWS publication is aborted within its DNS budget even with SDK retries',async t=>{
 const f=await fixture(3);f.hang();t.mock.timers.enable({apis:['setTimeout']});
 const result=f.dns.present(name,token).then(()=> 'resolved',()=> 'rejected');
 try{await f.received();t.mock.timers.tick(75000);const settled=await Promise.race([result,new Promise(resolve=>setImmediate(()=>resolve('pending')))]);assert.equal(settled,'rejected');}
 finally{t.mock.timers.reset();await f.close();await result;}
});
test('the caller can cancel a hung publication without waiting for the DNS budget',async()=>{
 const f=await fixture(),controller=new AbortController();f.hang();
 const result=f.dns.present(name,token,controller.signal).then(()=> 'resolved',()=> 'rejected');
 try{await f.received();controller.abort();const settled=await Promise.race([result,new Promise(resolve=>setImmediate(()=>resolve('pending')))]);assert.equal(settled,'rejected');}
 finally{await f.close();await result;}
});

test('a refused propagation read and a missing change ID fail without more polling',async()=>{
 const f=await fixture();try{f.denyGet();await assert.rejects(f.dns.present(name,token),{name:'AccessDenied'});assert.deepEqual(f.requests.map(r=>r.method),['POST','GET']);}finally{await f.close();}
 const g=await fixture();try{g.missingId();await assert.rejects(g.dns.present(name,token),/route53_change_unavailable/);assert.deepEqual(g.requests.map(r=>r.method),['POST']);}finally{await g.close();}
});

test('a hung propagation read shares the publication deadline',async t=>{
 const f=await fixture(3);f.hangGet();t.mock.timers.enable({apis:['setTimeout']});const result=f.dns.present(name,token).then(()=> 'resolved',()=> 'rejected');
 try{await f.received(2);t.mock.timers.tick(75000);assert.equal(await Promise.race([result,new Promise(resolve=>setImmediate(()=>resolve('pending')))]),'rejected');}
 finally{t.mock.timers.reset();await f.close();await result;}
});
test('cleanup has a shorter request deadline and reports uncertain cleanup without values',async t=>{
 const f=await fixture(),warnings=t.mock.method(console,'error',()=>{});await f.dns.present(name,token);f.hang();t.mock.timers.enable({apis:['setTimeout']});const result=f.dns.remove(name,token).then(()=> 'resolved',()=> 'rejected');
 try{await f.received(3);t.mock.timers.tick(10000);assert.equal(await Promise.race([result,new Promise(resolve=>setImmediate(()=>resolve('pending')))]),'rejected');assert.deepEqual(warnings.mock.calls.map(c=>c.arguments),[['remote.dns_cleanup_failed']]);}
 finally{t.mock.timers.reset();await f.close();await result;}
});
