import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {test} from 'node:test';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {TranslationMachine,TranslationWorker,type ModelClient} from '../src/index.ts';

const pool={query(){assert.fail('construction must not open a database connection');}};
const signer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const client:ModelClient={provider:'openai',model:'synthetic',async respond(){assert.fail('construction must not call a provider');}};
const api=await import(new URL('../src/index.ts',import.meta.url).href);
for(const mode of [undefined,'existing','test-free-paid','test-venue-levels'])test(`venue translation constructors accept explicit ${mode??'default'} without doing work`,()=>{
 assert.ok(new api.TranslationMachine(pool,signer,'https://cloud.example.test',undefined,512,mode) instanceof TranslationMachine);
 assert.ok(new api.TranslationWorker(pool,client,{planMode:mode}) instanceof TranslationWorker);
});
for(const mode of [null,'','production','test',true,1])test(`venue translation constructors refuse invalid mode ${JSON.stringify(mode)} before work`,()=>{
 assert.throws(()=>new api.TranslationMachine(pool,signer,'https://cloud.example.test',undefined,512,mode),/^Error: invalid_plan_mode$/);
 assert.throws(()=>new api.TranslationWorker(pool,client,{planMode:mode}),/^Error: invalid_plan_mode$/);
});
