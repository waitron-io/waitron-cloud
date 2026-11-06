import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {Route53Client} from '@aws-sdk/client-route-53';
import {createRoute53DnsProvider} from '../src/route53-dns.ts';

const name='_acme-challenge.staff-v-11111111-1111-4111-8111-111111111111.test.waitron.io';
const token='A'.repeat(43);
async function fixture(){
 const requests:{method:string;path:string;body:string}[]=[],records=new Map<string,string>();let pending=0,denied=false;
 const server=createServer(async(req,res)=>{
  let body='';for await(const part of req)body+=part;
  requests.push({method:req.method!,path:req.url!,body});res.setHeader('Content-Type','text/xml');
  const error=(code:string)=>{res.statusCode=400;res.end(`<ErrorResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><Error><Code>${code}</Code><Message>Refused</Message></Error></ErrorResponse>`);};
  if(denied){error('AccessDenied');return;}
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
  res.end('<ChangeResourceRecordSetsResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><ChangeInfo><Id>/change/C1</Id><Status>PENDING</Status><SubmittedAt>2026-11-06T00:00:00Z</SubmittedAt></ChangeInfo></ChangeResourceRecordSetsResponse>');
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 const client=new Route53Client({region:'us-east-1',endpoint:`http://127.0.0.1:${address.port}`,credentials:{accessKeyId:'test',secretAccessKey:'test'},maxAttempts:1});
 const dns=createRoute53DnsProvider({zoneId:'Z123',suffix:'test.waitron.io'},client);
 return {dns,requests,records,setPending(){pending=1;},deny(){denied=true;},async close(){client.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
test('publishes only the challenge TXT value, waits for authoritative propagation and removes it exactly',async()=>{
 const f=await fixture();try{
  f.setPending();await f.dns.present(name,token);assert.equal(f.records.get(name),'"'+token+'"');
  assert.deepEqual(f.requests.map(r=>r.method),['POST','GET','GET']);
  await f.dns.remove(name,token);assert.equal(f.records.size,0);assert.equal(f.requests.at(-2)!.method,'POST');assert.match(f.requests.at(-2)!.body,/<Action>DELETE<\/Action>/);
 }finally{await f.close();}
});
test('refuses unrelated names and malformed challenge values before any AWS request',async()=>{
 const f=await fixture();try{
  for(const invalid of ['test.waitron.io','_acme-challenge.test.waitron.io','_acme-challenge.other.waitron.io','_acme-challenge.box.test.waitron.io.attacker.test','_acme-challenge.*.test.waitron.io','_acme-challenge.foo..test.waitron.io','_acme-challenge.foo.TEST.waitron.io']){
   await assert.rejects(f.dns.present(invalid,token),/invalid_dns_challenge/);await assert.rejects(f.dns.remove(invalid,token),/invalid_dns_challenge/);
  }
  for(const invalid of ['',token+'"',token+'\n',token.slice(1)])await assert.rejects(f.dns.present(name,invalid),/invalid_dns_challenge/);
  for(const config of [{zoneId:'',suffix:'test.waitron.io'},{zoneId:'Z123/rrset',suffix:'test.waitron.io'},{zoneId:'Z123',suffix:'*.test.waitron.io'}])assert.throws(()=>createRoute53DnsProvider(config),/invalid_route53_configuration/);
  assert.equal(f.requests.length,0);
 }finally{await f.close();}
});
test('old cleanup cannot delete a newer challenge and service refusals remain failures',async()=>{
 const f=await fixture();try{
  await f.dns.present(name,token);f.records.set(name,'"'+'B'.repeat(43)+'"');
  await assert.rejects(f.dns.remove(name,token),{name:'InvalidChangeBatch'});assert.equal(f.records.get(name),'"'+'B'.repeat(43)+'"');
  f.deny();const before=f.requests.length;await assert.rejects(f.dns.present(name,token),{name:'AccessDenied'});assert.equal(f.requests.length,before+1);
 }finally{await f.close();}
});
