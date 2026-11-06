import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {createGoogleAddressClient} from '../src/address-lookup-google.ts';

const sessionToken='123e4567-e89b-42d3-a456-426614174000';
test('Google suggestions carry only text while the request carries Spain, language and the session',async()=>{
 const calls:{url:string;options:RequestInit}[]=[];
 const client=createGoogleAddressClient({apiKey:'synthetic-key',fetcher:async(url,options)=>{
  calls.push({url:String(url),options:options!});
  return Response.json({suggestions:[{placePrediction:{place:'places/private-id',placeId:'private-id',text:{text:'Calle de Prueba 12, Madrid',matches:[]},types:['street_address'],distanceMeters:7}}]});
 }});
 assert.deepEqual(await client.suggest({query:'Calle de Prueba 12',language:'es',sessionToken}),{
  provider:'google',candidates:[{text:'Calle de Prueba 12, Madrid'}],
 });
 assert.equal(calls.length,1);
 assert.equal(calls[0]!.url,'https://places.googleapis.com/v1/places:autocomplete');
 assert.equal(calls[0]!.options.redirect,'error');
 assert.equal(new Headers(calls[0]!.options.headers).get('X-Goog-Api-Key'),'synthetic-key');
 assert.deepEqual(JSON.parse(String(calls[0]!.options.body)),{input:'Calle de Prueba 12',includedRegionCodes:['es'],languageCode:'es',sessionToken});
});

const address={postalAddress:{regionCode:'ES',postalCode:'28013',locality:'Madrid'},addressComponents:[
 {componentType:'route',componentName:{text:'Calle de Prueba',languageCode:'es'},confirmationLevel:'CONFIRMED'},
 {componentType:'street_number',componentName:{text:'12'},confirmationLevel:'CONFIRMED'},
 {componentType:'subpremise',componentName:{text:'2º B'},confirmationLevel:'UNCONFIRMED_BUT_PLAUSIBLE'},
 {componentType:'administrative_area_level_2',componentName:{text:'Madrid'},confirmationLevel:'CONFIRMED'},
 {componentType:'country',componentName:{text:'España',languageCode:'es'},confirmationLevel:'CONFIRMED'},
]};
const validationReply={result:{address,verdict:{addressComplete:true},geocode:{placeId:'private-id',location:{latitude:40,longitude:-3}},metadata:{business:true}},responseId:'private-response-id'};
test('validation maps only editable address fields and never claims country-pack acceptance',async()=>{
 const calls:RequestInit[]=[];
 const client=createGoogleAddressClient({apiKey:'synthetic-key',fetcher:async(url,options)=>{
  assert.equal(String(url),'https://addressvalidation.googleapis.com/v1:validateAddress');calls.push(options!);return Response.json(validationReply);
 }});
 assert.equal(typeof client.validate,'function');
 assert.deepEqual(await client.validate({selectedText:'Calle de Prueba 12, Madrid',sessionToken}),{
  provider:'google',fields:{addressLine1:'Calle de Prueba 12',addressLine2:'2º B',postalCode:'28013',city:'Madrid',province:'Madrid',countryCode:'ES'},
 });
 assert.equal(calls.length,1);assert.equal(calls[0]!.redirect,'error');
 assert.deepEqual(JSON.parse(String(calls[0]!.body)),{address:{regionCode:'ES',addressLines:['Calle de Prueba 12, Madrid']},sessionToken});
 const partial=createGoogleAddressClient({apiKey:'k',fetcher:async()=>Response.json({result:{address:{postalAddress:{regionCode:'ES'}}}})});
 assert.deepEqual(await partial.validate({selectedText:'Calle de Prueba',sessionToken}),{
  provider:'google',fields:{addressLine1:'',addressLine2:null,postalCode:'',city:'',province:'',countryCode:'ES'},
 });
});

async function refuses(action:()=>Promise<unknown>,code:string,dispatched:boolean){
 await assert.rejects(action,(error:unknown)=>{
  assert.ok(error instanceof Error);assert.equal(error.message,code);
  assert.equal((error as Error&{dispatched:boolean}).dispatched,dispatched);
  for(const text of [String(error),error.stack??'',JSON.stringify(error)])for(const secret of ['synthetic-secret','PRIVATE-QUERY','PRIVATE-REPLY'])assert.equal(text.includes(secret),false);
  return true;
 });
}
test('invalid inputs cannot reach fetch, including UTF-8, token, language and validation boundaries',async()=>{
 let sends=0;const client=createGoogleAddressClient({apiKey:'k',fetcher:async()=>{sends++;return Response.json({});}});
 for(const input of [
  {query:'',language:'es',sessionToken},{query:'x'.repeat(513),language:'es',sessionToken},
  {query:'é'.repeat(257),language:'es',sessionToken},{query:'x',language:'fr',sessionToken},
  {query:'x',language:'es',sessionToken:''},{query:'x',language:'es',sessionToken:'a'.repeat(37)},
  {query:'x',language:'es',sessionToken:'a/b'},
 ])await refuses(()=>client.suggest(input as Parameters<typeof client.suggest>[0]),'invalid_input',false);
 assert.equal(typeof client.validate,'function');
 for(const selectedText of ['', 'x'.repeat(279),'😀'.repeat(129)])await refuses(()=>client.validate({selectedText,sessionToken}),'invalid_input',false);
 assert.equal(sends,0);
 assert.deepEqual(await client.suggest({query:'é'.repeat(256),language:'en',sessionToken}),{provider:'google',candidates:[]});
 const valid=createGoogleAddressClient({apiKey:'k',fetcher:async()=>Response.json({result:{address:{postalAddress:{regionCode:'ES'}}}})});
 assert.equal((await valid.validate({selectedText:'x'.repeat(278),sessionToken})).fields.countryCode,'ES');
 assert.equal((await valid.validate({selectedText:'😀'.repeat(128),sessionToken})).fields.countryCode,'ES');
 assert.equal((await valid.validate({selectedText:'x'.repeat(200)+'😀'.repeat(78),sessionToken})).fields.countryCode,'ES');
});
test('missing or foreign country, contradictory components and malformed replies cannot become drafts',async()=>{
 const replies=[{}, {result:{}}, {result:{address:{postalAddress:{}}}},
  {result:{address:{postalAddress:{regionCode:'PT'}}}},
  {result:{address:{...address,addressComponents:[...address.addressComponents.filter(c=>c.componentType!=='country'),{componentType:'country',componentName:{text:'Portugal'}}]}}},
  {result:{address:{...address,addressComponents:[...address.addressComponents,{componentType:'route',componentName:{text:'Other street'}}]}}},
  {result:{address:{...address,postalAddress:{...address.postalAddress,postalCode:123}}}},
 ];
 for(const reply of replies){
  const client=createGoogleAddressClient({apiKey:'k',fetcher:async()=>Response.json(reply)});
  assert.equal(typeof client.validate,'function');await refuses(()=>client.validate({selectedText:'PRIVATE-QUERY',sessionToken}),'malformed',true);
 }
});
test('suggestions are bounded, empty stays empty and malformed or oversized replies fail without leaking',async()=>{
 for(const reply of [{},{suggestions:[]}]){
  const client=createGoogleAddressClient({apiKey:'k',fetcher:async()=>Response.json(reply)});
  assert.deepEqual(await client.suggest({query:'x',language:'es',sessionToken}),{provider:'google',candidates:[]});
 }
 const list=createGoogleAddressClient({apiKey:'k',fetcher:async()=>Response.json({suggestions:Array.from({length:6},(_,i)=>({placePrediction:{text:{text:'Street '+i}}}))})});
 assert.deepEqual((await list.suggest({query:'x',language:'es',sessionToken})).candidates,[{text:'Street 0'},{text:'Street 1'},{text:'Street 2'},{text:'Street 3'},{text:'Street 4'}]);
 for(const raw of ['PRIVATE-REPLY','null','{"suggestions":{}}','{"suggestions":[{"placePrediction":{"text":{"text":3}}}]}','{"error":"PRIVATE-REPLY"}', '{}'+ ' '.repeat(65535)]){
  const client=createGoogleAddressClient({apiKey:'synthetic-secret',fetcher:async()=>new Response(raw)});
  await refuses(()=>client.suggest({query:'PRIVATE-QUERY',language:'es',sessionToken}),'malformed',true);
 }
 const exact=createGoogleAddressClient({apiKey:'k',fetcher:async()=>new Response('{}'+' '.repeat(65534))});
 assert.deepEqual(await exact.suggest({query:'x',language:'es',sessionToken}),{provider:'google',candidates:[]});
});
test('a real HTTP redirect is not followed with the provider key',async()=>{
 const paths:string[]=[];
 const server=createServer((request,response)=>{
  paths.push(request.url!);assert.equal(request.headers['x-goog-api-key'],'synthetic-key');
  response.writeHead(302,{location:'/steal'});response.end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const client=createGoogleAddressClient({apiKey:'synthetic-key',fetcher:(url,options)=>{
   assert.equal(String(url),'https://places.googleapis.com/v1/places:autocomplete');
   return fetch(`http://127.0.0.1:${address.port}/autocomplete`,options);
  }});
  await refuses(()=>client.suggest({query:'x',language:'es',sessionToken}),'unavailable',true);
  assert.deepEqual(paths,['/autocomplete']);
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test('provider failures are fixed, classified and never retried, while pre-dispatch cancellation sends nothing',async()=>{
 for(const [status,code] of [[400,'refused'],[401,'refused'],[403,'refused'],[429,'rate_limited'],[503,'unavailable'],[302,'refused']] as const){
  let sends=0;const client=createGoogleAddressClient({apiKey:'synthetic-secret',fetcher:async()=>{sends++;return new Response('PRIVATE-REPLY',{status});}});
  await refuses(()=>client.suggest({query:'PRIVATE-QUERY',language:'es',sessionToken}),code,true);assert.equal(sends,1);
 }
 let sends=0;const broken=createGoogleAddressClient({apiKey:'synthetic-secret',fetcher:async()=>{sends++;throw new Error('synthetic-secret PRIVATE-QUERY');}});
 await refuses(()=>broken.suggest({query:'PRIVATE-QUERY',language:'es',sessionToken}),'unavailable',true);assert.equal(sends,1);
 const stopped=new AbortController();stopped.abort(new Error('synthetic-secret'));
 const client=createGoogleAddressClient({apiKey:'k',fetcher:async()=>{sends++;return Response.json({});}});
 await refuses(()=>client.suggest({query:'x',language:'es',sessionToken},stopped.signal),'cancelled',false);assert.equal(sends,1);
});
test('the five-second deadline includes headers and a body that never finishes',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const stage of ['headers','body']){
  let cancelled=false;
  const client=createGoogleAddressClient({apiKey:'k',fetcher:async(_url,options)=>{
   if(stage==='headers')return new Promise<Response>((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(new Error('PRIVATE-REPLY')),{once:true}));
   return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}));
  }});
  let settled=false;
  const pending=refuses(()=>client.suggest({query:'x',language:'es',sessionToken}),'timeout',true).then(()=>{settled=true;});
  await new Promise<void>(resolve=>setImmediate(resolve));t.mock.timers.tick(4999);
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(settled,false);t.mock.timers.tick(1);
  await pending;if(stage==='body')assert.equal(cancelled,true);
 }
});
test('cancellation after dispatch cancels the active body and stays an uncertain send',async()=>{
 const stop=new AbortController();let cancelled=false;
 const client=createGoogleAddressClient({apiKey:'k',fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 const pending=refuses(()=>client.suggest({query:'x',language:'es',sessionToken},stop.signal),'cancelled',true);
 await new Promise<void>(resolve=>setImmediate(resolve));stop.abort(new Error('synthetic-secret'));
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(cancelled,true);
 await pending;assert.equal(cancelled,true);
});
test('invalid credentials or a missing injected transport fail locally without exposing the key',()=>{
 for(const options of [{apiKey:'',fetcher:fetch},{apiKey:'synthetic-secret\nPRIVATE-QUERY',fetcher:fetch},{apiKey:'synthetic-secret'}]){
  assert.throws(()=>createGoogleAddressClient(options as Parameters<typeof createGoogleAddressClient>[0]),(error:unknown)=>{
   assert.ok(error instanceof Error);assert.equal(error.message,'invalid_input');
   assert.equal((error as Error&{dispatched:boolean}).dispatched,false);
   assert.equal(error.stack?.includes('synthetic-secret'),false);return true;
  });
 }
});
