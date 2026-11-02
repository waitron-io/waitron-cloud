import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RelayGrantStore} from '../src/relay-grants.ts';
import {RelayMessages} from '../src/relay-messages.ts';
import {RelayWorker} from '../src/relay-worker.ts';

// Dropping constructor validation must permit an invalid option before any database work.
for(const [name,construct] of Object.entries({
 grants:(mode:string,value:unknown)=>new (RelayGrantStore as any)({},undefined,mode,value),
 messages:(mode:string,value:unknown)=>new (RelayMessages as any)({}, {},'http://localhost',undefined,undefined,mode,value),
 worker:(mode:string,value:unknown)=>new (RelayWorker as any)({},undefined,mode,value),
}))test('relay '+name+' validates allowance options before resources',()=>{
 for(const mode of ['existing','test-free-paid'])assert.throws(()=>construct(mode,{mode:'test',calendar:'UTC'}),{code:'invalid_allowance_input'});
 for(const value of [null,false,{}, {mode:'production',calendar:'UTC'}, {mode:'test',calendar:'Europe/Rome'}, {mode:'test',calendar:'UTC',extra:true}])assert.throws(()=>construct('test-venue-levels',value),{code:'invalid_allowance_input'});
});
