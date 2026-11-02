import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as rules from '../src/billing-allowance-rules.ts';

function validate(value:unknown,mode:string):unknown{
 const fn=(rules as unknown as Record<string,unknown>).validateAllowanceOptions;
 assert.equal(typeof fn,'function','service constructors require strict test-only allowance options');
 return (fn as (value:unknown,mode:string)=>unknown)(value,mode);
}
test('missing allowance options preserve all existing plan modes',()=>{
 for(const mode of ['existing','test-free-paid','test-venue-levels'])assert.equal(validate(undefined,mode),undefined);
});
test('explicit allowance options require the qualified venue-level mode and UTC',()=>{
 const input={mode:'test',calendar:'UTC'};
 const output=validate(input,'test-venue-levels');assert.deepEqual(output,input);assert.notEqual(output,input);
 for(const mode of ['existing','test-free-paid','production','invalid'])assert.throws(()=>validate(input,mode),{code:'invalid_allowance_input'});
});
for(const value of [null,false,true,0,'test',[],{}, {mode:'test'}, {calendar:'UTC'},
 {mode:'production',calendar:'UTC'}, {mode:'test',calendar:'Europe/Rome'}, {mode:'test',calendar:'UTC',enabled:true}])
 test('malformed allowance options refuse '+JSON.stringify(value),()=>{
  assert.throws(()=>validate(value,'test-venue-levels'),{code:'invalid_allowance_input'});
 });
