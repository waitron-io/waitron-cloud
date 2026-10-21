import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InstallationError} from '@waitron-cloud/registration';
import {checkSubmitBody} from '../src/submit-proof.ts';

for(const {name,body,jobBytes} of [
  {name:'a longer ASCII body',body:'menu',jobBytes:3},
  {name:'a shorter ASCII body',body:'menu',jobBytes:5},
  {name:'an empty body',body:'',jobBytes:1},
  {name:'a multibyte body with its character count',body:'ó🍽',jobBytes:3},
  {name:'an unpaired surrogate with its character count',body:'\ud800',jobBytes:1},
  {name:'an actual body above 1 MiB with a small declaration',body:'a'.repeat(1048577),jobBytes:1},
])test(`${name} is refused before allocating its UTF-8 buffer`,t=>{
  const proof=JSON.stringify({version:1,jobSha256:'0'.repeat(64),jobBytes});
  const from=t.mock.method(Buffer,'from');
  try{
    assert.throws(()=>checkSubmitBody(proof,body),
      (error:unknown)=>error instanceof InstallationError&&error.code==='invalid_proof');
    assert.equal(from.mock.callCount(),0,'a mismatched length must not allocate or hash the body');
  }finally{from.mock.restore();}
});
