import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as api from './test-cloud-free-services.mjs';

const ids=['rules','installations','backups','recovery','remote','translation','relay','runtime','storage'];
function receipt(){return {version:2,kind:'test-cloud-venue-services',cloudHead:'a'.repeat(40),cloudTree:'b'.repeat(40),scope:'local-fixtures',mode:'test-venue-levels',productionEnforcement:'off',suites:ids.map(id=>({id,tests:2,passed:2,failed:0,cancelled:0,skipped:0,todo:0}))};}
test('venue service receipt qualifies the complete local matrix separately from legacy evidence',()=>{
 assert.equal(typeof api.validateVenueServiceReceipt,'function','venue service proof validator is required');
 assert.equal(api.validateVenueServiceReceipt(receipt()),true);
 assert.throws(()=>api.validateFreeServiceReceipt(receipt()));
});
test('venue service receipt refuses omitted, extra or malformed authority and candidate fields',()=>{
 assert.equal(typeof api.validateVenueServiceReceipt,'function');
 for(const field of ['version','kind','cloudHead','cloudTree','scope','mode','productionEnforcement','suites']){
  for(const value of [undefined,null,false,true,'',{},[]]){
   const r=receipt();if(value===undefined)delete r[field];else r[field]=value;
   assert.throws(()=>api.validateVenueServiceReceipt(r),`${field}: ${JSON.stringify(value)}`);
  }
 }
 for(const [field,value] of [['version',1],['kind','test-cloud-free-services'],['scope','production'],['mode','test-free-paid'],['productionEnforcement','on'],['cloudHead','main'],['cloudTree','a'.repeat(39)],['token','private']]){
  const r=receipt();r[field]=value;assert.throws(()=>api.validateVenueServiceReceipt(r),field);
 }
});
test('venue service receipt refuses partial suites, nonpassing cases and hidden suite fields',()=>{
 assert.equal(typeof api.validateVenueServiceReceipt,'function');
 for(const mutate of [r=>r.suites.pop(),r=>r.suites.push(r.suites[0]),r=>r.suites[0].id='foreign',r=>r.suites[0].private='value']){
  const r=receipt();mutate(r);assert.throws(()=>api.validateVenueServiceReceipt(r));
 }
 for(const field of ['id','tests','passed','failed','cancelled','skipped','todo']){
  const r=receipt();delete r.suites[0][field];assert.throws(()=>api.validateVenueServiceReceipt(r),field);
 }
 for(const [field,values] of Object.entries({tests:[0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1],passed:[0,1,'2'],failed:[1,'0'],cancelled:[1,'0'],skipped:[1,'0'],todo:[1,'0']})){
  for(const value of values){const r=receipt();r.suites[0][field]=value;assert.throws(()=>api.validateVenueServiceReceipt(r),field);}
 }
});
