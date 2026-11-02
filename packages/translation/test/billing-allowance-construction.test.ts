import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {Pool} from 'pg';
import {createLeaseIssuer} from '@waitron-cloud/registration';

const api=await import(new URL('../src/index.ts',import.meta.url).href);
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
for(const [mode,options] of [
 ['existing',{mode:'test',calendar:'UTC'}],['test-free-paid',{mode:'test',calendar:'UTC'}],
 ['test-venue-levels',null],['test-venue-levels',false],['test-venue-levels',{}],
 ['test-venue-levels',{mode:'production',calendar:'UTC'}],['test-venue-levels',{mode:'test',calendar:'Europe/Rome'}],
 ['test-venue-levels',{mode:'test',calendar:'UTC',enabled:true}],
] as const)test('translation construction refuses invalid allowance binding '+JSON.stringify([mode,options]),async()=>{
 const pool=new Pool();try{
  assert.throws(()=>new api.TranslationMachine(pool,issuer,'https://cloud.example.test',undefined,undefined,mode,options),{code:'invalid_allowance_input'});
  assert.equal(pool.totalCount,0);
 }finally{await pool.end();}
});
test('translation construction keeps allowances absent by default and accepts explicit qualified test options',async()=>{
 const pool=new Pool();try{
  for(const mode of ['existing','test-free-paid','test-venue-levels'])new api.TranslationMachine(pool,issuer,'https://cloud.example.test',undefined,undefined,mode);
  new api.TranslationMachine(pool,issuer,'https://cloud.example.test',undefined,undefined,'test-venue-levels',{mode:'test',calendar:'UTC'});
  assert.equal(pool.totalCount,0);
 }finally{await pool.end();}
});
