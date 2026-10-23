import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {readVerificationInput,verificationInput} from '../src/verification-transport.ts';
const request=JSON.parse(await readFile(new URL('./fixtures/verification-vector.json',import.meta.url),'utf8'));
const key={version:1,reference:'key-1',secret:'private-ñ-fixture'};
function frame(bytes:Buffer|string){const body=Buffer.from(bytes),size=Buffer.alloc(4);size.writeUInt32BE(body.length);return Buffer.concat([size,body]);}
const wire=(req=JSON.stringify(request),secret=JSON.stringify(key))=>Buffer.concat([frame(req),frame(secret),Buffer.from([0,255,128,1,2])]);
async function bytes(source:AsyncIterable<Uint8Array>){const chunks=[];for await(const chunk of source)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
test('private input frames survive every byte split without including the secret in the request',async()=>{
 const expected=wire();
 for(const size of [1,2,3,4,5,17,65536]){
  const chunks=[];for(let offset=0;offset<expected.length;offset+=size)chunks.push(expected.subarray(offset,offset+size));
  const value=await readVerificationInput(Readable.from(chunks));assert.deepEqual(value.request,request);assert.deepEqual(value.key,key);assert.deepEqual(await bytes(value.archive),Buffer.from([0,255,128,1,2]));
 }
 assert.deepEqual(await bytes(verificationInput(request,key,Readable.from([Buffer.from([0,255,128,1,2])]))),expected);
 assert.equal(JSON.stringify(request).includes(key.secret),false);
});
for(const limit of [0,65537,0xffffffff])test(`request frame length ${limit} is refused without reading its body`,async()=>{
 let pulled=0;const size=Buffer.alloc(4);size.writeUInt32BE(limit);
 const source=(async function*(){pulled++;yield size;pulled++;throw Error('body must not be read');})();
 await assert.rejects(readVerificationInput(source),/backup.verifier_input/);assert.equal(pulled,1);
});
for(const limit of [0,4097,0xffffffff])test(`secret frame length ${limit} is refused without reading its body`,async()=>{
 let pulled=0;const size=Buffer.alloc(4);size.writeUInt32BE(limit);
 const source=(async function*(){yield frame(JSON.stringify(request));pulled++;yield size;pulled++;throw Error('body must not be read');})();
 await assert.rejects(readVerificationInput(source),/backup.verifier_input/);assert.equal(pulled,1);
});
for(const cut of [0,1,3,4,50,JSON.stringify(request).length+3])test(`private input truncated at ${cut} bytes is refused`,async()=>{
 await assert.rejects(readVerificationInput(Readable.from([wire().subarray(0,cut)])),/backup.verifier_input/);
});
for(const secret of ['null','[]','{}',JSON.stringify({...key,version:2}),JSON.stringify({...key,reference:'foreign'}),JSON.stringify({...key,extra:'private'}),JSON.stringify({...key,secret:''}),JSON.stringify({...key,secret:'x'.repeat(2049)}),'{"version":2,"vers\\u0069on":1,"reference":"key-1","secret":"x"}',JSON.stringify(key).replace('"version":1','"version":1.0')])test(`private secret refuses shape or binding ${secret.slice(0,48)}`,async()=>{
 await assert.rejects(readVerificationInput(Readable.from([wire(undefined,secret)])));
});
test('private secret bytes are decoded with fatal UTF-8 before permissive replacement can hide corruption',async()=>{
 const malformed=Buffer.concat([Buffer.from('{"version":1,"reference":"key-1","secret":"'),Buffer.from([0xc0,0xaf]),Buffer.from('"}')]);
 await assert.rejects(readVerificationInput(Readable.from([frame(JSON.stringify(request)),frame(malformed)])));
});
test('request duplicate keys are refused before any private secret or archive is read',async()=>{
 let pulled=0;const raw=JSON.stringify(request).replace('"captureId":"capture-1"','"captureId":"foreign","captureId":"capture-1"');
 await assert.rejects(readVerificationInput((async function*(){yield frame(raw);pulled++;throw Error('secret must stay unread')})()));assert.equal(pulled,0);
});
