import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';

test('SES signing creates a tagged external identity and reads its exact status without retrying writes', async t => {
 const {createSesSigningProvider}=await import('../src/ses-signing.ts').catch(error=>{
  assert.fail('A venue signing adapter is required: '+(error as Error).message);
 });
 const domain='venue.example.test', selector='11111111-1111-4111-8111-111111111111';
 const tag='22222222-2222-4222-8222-222222222222', privateKey='synthetic-private-key';
 const path='/v2/email/identities', calls:{method:string;url:string;input?:unknown}[]=[];
 let exists=false, failCreate=false;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  calls.push({method:req.method!,url:req.url!,...(body?{input:JSON.parse(body)}:{})});
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'&&failCreate){res.statusCode=500;res.end(JSON.stringify({message:'Provider did not confirm the write'}));return;}
  if(req.method==='POST')exists=true;
  if(req.method==='DELETE')exists=false;
  if(req.method==='GET'&&!exists){
   res.statusCode=404;res.setHeader('x-amzn-errortype','NotFoundException');
   res.end(JSON.stringify({message:'Identity absent'}));return;
  }
  res.end(JSON.stringify({IdentityType:'DOMAIN',VerifiedForSendingStatus:true,
   Tags:[{Key:'waitron-venue-mail',Value:tag}],
   DkimAttributes:{SigningAttributesOrigin:'EXTERNAL',SigningEnabled:true,Status:'SUCCESS',Tokens:[selector]}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const ses=createSesSigningProvider({region:'eu-north-1',endpoint:'http://127.0.0.1:'+address.port,
  credentials:{accessKeyId:'test',secretAccessKey:'test'}});
 t.after(async()=>{ses.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 assert.equal(await ses.read(domain),null);
 await ses.create(domain,selector,tag,privateKey);
 assert.deepEqual(calls[1],{method:'POST',url:path,input:{EmailIdentity:domain,
  DkimSigningAttributes:{DomainSigningSelector:selector,DomainSigningPrivateKey:privateKey},
  Tags:[{Key:'waitron-venue-mail',Value:tag}]}});
 assert.deepEqual(await ses.read(domain),{tag,selectors:[selector],external:true,verified:true});
 await ses.remove(domain);
 assert.equal(await ses.read(domain),null);
 assert.deepEqual(calls.slice(2).map(({method,url})=>[method,url]),[
  ['GET',path+'/'+domain],['DELETE',path+'/'+domain],['GET',path+'/'+domain],
 ]);
 failCreate=true;
 await assert.rejects(ses.create(domain,selector,tag,privateKey));
 assert.equal(calls.filter(call=>call.method==='POST').length,2);
});
