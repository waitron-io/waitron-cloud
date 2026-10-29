import assert from 'node:assert/strict';
import {test} from 'node:test';

const version={revision:1,effectiveFrom:'2026-10-01',currency:'EUR',prices:{connectedMonthlyCents:1000,hostedMonthlyCents:3000},vatRateBasisPoints:2100};
async function validator(){
 const api=await import(new URL('../src/index.ts',import.meta.url).href);
 assert.equal(typeof api.validateBillingPrice,'function','published prices need explicit validation');
 return api.validateBillingPrice as (value:unknown)=>typeof version;
}

test('published prices have no defaults and validate whole safe cents',async()=>{
 const validate=await validator();
 assert.deepEqual(validate(version),version);
 assert.deepEqual(validate({...version,prices:{connectedMonthlyCents:0,hostedMonthlyCents:0},vatRateBasisPoints:0}),{...version,prices:{connectedMonthlyCents:0,hostedMonthlyCents:0},vatRateBasisPoints:0});
 const invalid:unknown[]=[undefined,null,{},[],{...version,revision:0},{...version,revision:1.5},
  {...version,revision:Number.MAX_SAFE_INTEGER+1},{...version,currency:'USD'},
  {...version,effectiveFrom:'2026-02-30'},{...version,effectiveFrom:'2026-2-01'},
  {...version,effectiveFrom:'0000-01-01'},{...version,effectiveFrom:'2026-10-01T00:00:00Z'},
  {...version,effectiveFrom:'2026-10-01\n'},{...version,vatRateBasisPoints:-1},
  {...version,vatRateBasisPoints:10001},{...version,vatRateBasisPoints:21.1},
  {...version,vatRateBasisPoints:NaN},{...version,apiKey:'not-storable'},
  {...version,prices:{...version.prices,iban:'not-storable'}}];
 for(const field of Object.keys(version)) {const copy:Record<string,unknown>={...version};delete copy[field];invalid.push(copy);}
 for(const field of ['connectedMonthlyCents','hostedMonthlyCents']){
  for(const value of [-1,0.1,NaN,Infinity,'1000',undefined,Number.MAX_SAFE_INTEGER,Math.floor(Number.MAX_SAFE_INTEGER/10000)+1])
   invalid.push({...version,prices:{...version.prices,[field]:value}});
 }
 for(const input of invalid) assert.throws(()=>validate(input),error=>{
  assert.equal((error as {code:string}).code,'invalid_billing_input');
  assert.equal((error as Error).message,'invalid_billing_input');return true;
 });
});

test('published price validation preserves explicit leap dates and operand boundaries',async()=>{
 const validate=await validator();
 const value={...version,effectiveFrom:'2028-02-29',prices:{connectedMonthlyCents:900719925474,hostedMonthlyCents:900719925474},vatRateBasisPoints:10000};
 assert.deepEqual(validate(value),value);
 assert.throws(()=>validate({...value,effectiveFrom:'2027-02-29'}),{code:'invalid_billing_input'});
 const result=validate(version);result.prices.connectedMonthlyCents=5;
 assert.equal(version.prices.connectedMonthlyCents,1000,'validation returns its own value, not caller-owned mutable input');
});
