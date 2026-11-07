import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {spawnSync,execFileSync} from 'node:child_process';

const input={query:'Calle de Prueba',language:'es' as const,sessionToken:'synthetic-session'};
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'address-key-')),keyFile=join(directory,'google.env');
 await writeFile(keyFile,'GOOGLE_MAPS_SERVER_KEY=synthetic-first\n',{mode:0o600});
 return {directory,keyFile,close:()=>rm(directory,{recursive:true,force:true})};
}
async function factory(){
 const module=await import('../src/test-box-address-lookup.ts').catch(()=>({createTestBoxAddressLookup:undefined}));
 assert.equal(typeof module.createTestBoxAddressLookup,'function','trial activation must provide the bounded key-file adapter');
 return module.createTestBoxAddressLookup!;
}
test('removing the server key stops both operations, and replacement is read on the next call',async()=>{
 const create=await factory(),f=await fixture();const keys:(string|null)[]=[];
 try{
  const provider=create({keyFile:f.keyFile,fetcher:async(_url,options)=>{
   keys.push(new Headers(options?.headers).get('X-Goog-Api-Key'));
   return Response.json({});
  }});
  assert.deepEqual(await provider.suggest(input),{provider:'google',candidates:[]});
  await writeFile(f.keyFile,'GOOGLE_MAPS_SERVER_KEY=synthetic-second\n');
  assert.deepEqual(await provider.suggest(input),{provider:'google',candidates:[]});
  assert.deepEqual(keys,['synthetic-first','synthetic-second']);
  await rm(f.keyFile);
  for(const run of [()=>provider.suggest(input),()=>provider.validate({selectedText:'Calle de Prueba',sessionToken:input.sessionToken})]){
   await assert.rejects(run,{message:'unavailable',dispatched:false});
  }
  assert.equal(keys.length,2);
 }finally{await f.close();}
});
test('validation uses the same file-backed client and forwards its editable draft',async()=>{
 const create=await factory(),f=await fixture();
 try{
  const provider=create({keyFile:f.keyFile,fetcher:async(url,options)=>{
   assert.equal(String(url),'https://addressvalidation.googleapis.com/v1:validateAddress');
   assert.equal(new Headers(options?.headers).get('X-Goog-Api-Key'),'synthetic-first');
   return Response.json({result:{address:{postalAddress:{regionCode:'ES',postalCode:'28013',locality:'Madrid'},addressComponents:[
    {componentType:'route',componentName:{text:'Calle de Prueba'}},
   ]}}});
  }});
  assert.deepEqual(await provider.validate({selectedText:'Calle de Prueba',sessionToken:input.sessionToken}),{
   provider:'google',fields:{addressLine1:'Calle de Prueba',addressLine2:null,postalCode:'28013',city:'Madrid',province:'',countryCode:'ES'},
  });
 }finally{await f.close();}
});
test('unprotected, linked and malformed key files refuse without disclosing their content or sending',async()=>{
 const create=await factory(),f=await fixture();let sends=0;
 try{
  const provider=create({keyFile:f.keyFile,fetcher:async()=>{sends++;return Response.json({});}});
  for(const setup of [
   ()=>chmod(f.keyFile,0o644),
   async()=>{await chmod(f.keyFile,0o600);await writeFile(f.keyFile,'OTHER_KEY=PRIVATE-SECRET\n');},
   ()=>writeFile(f.keyFile,'GOOGLE_MAPS_SERVER_KEY=\n'),
   ()=>writeFile(f.keyFile,'GOOGLE_MAPS_SERVER_KEY='+ 'x'.repeat(8192)),
   async()=>{
    const target=join(f.directory,'target.env');
    await writeFile(target,'GOOGLE_MAPS_SERVER_KEY=PRIVATE-SECRET\n',{mode:0o600});
    await rm(f.keyFile);await symlink(target,f.keyFile);
   },
  ]){
   await setup();await assert.rejects(()=>provider.suggest(input),(error:unknown)=>{
    assert.ok(error instanceof Error);assert.equal(error.message,'unavailable');
    assert.equal((error as Error&{dispatched:boolean}).dispatched,false);
    assert.equal(String(error.stack).includes('PRIVATE-SECRET'),false);return true;
   });
  }
  await rm(f.keyFile);await writeFile(f.keyFile,'GOOGLE_MAPS_SERVER_KEY=PRIVATE-SECRET\n',{mode:0o600});
  const uid=process.getuid!;
  try{
   process.getuid=()=>uid()+1;
   await assert.rejects(()=>provider.suggest(input),{message:'unavailable',dispatched:false});
  }finally{process.getuid=uid;}
  assert.equal(sends,0);
 }finally{await f.close();}
});
test('a named pipe refuses promptly without holding the provider call open',async()=>{
 const f=await fixture();
 try{
  await rm(f.keyFile);execFileSync('mkfifo',[f.keyFile]);
  const moduleUrl=new URL('../src/test-box-address-lookup.ts',import.meta.url).href;
  const script=`import {createTestBoxAddressLookup} from ${JSON.stringify(moduleUrl)};
   let sends=0;const p=createTestBoxAddressLookup({keyFile:${JSON.stringify(f.keyFile)},fetcher:async()=>{sends++;return Response.json({});}});
   try{await p.suggest(${JSON.stringify(input)});process.exitCode=1;}catch(e){console.log(JSON.stringify({code:e.code,dispatched:e.dispatched,sends}));}`;
  const r=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:2000});
  assert.equal(r.status,0,String(r.error??r.stderr));
  assert.deepEqual(JSON.parse(r.stdout),{code:'unavailable',dispatched:false,sends:0});
 }finally{await f.close();}
});
