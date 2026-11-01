import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {BillingLevel,TrialView} from '../src/billing-types.ts';

type Service='address_lookup'|'transactional_email'|'content_translation'|'continuous_backup'
 |'retained_snapshots'|'remote_access'|'rota_solver'|'hosting';
type Rules={
 levelAllows:(level:BillingLevel,service:Service)=>boolean;
 effectiveVenueLevel:(base:BillingLevel,trials:readonly TrialView[],today:string)=>BillingLevel;
 paidGrantWindow:(base:BillingLevel,trials:readonly TrialView[],today:string)=>{until:string|null}|null;
};
const modulePath='../src/venue-service-rules.ts';
const rules:Partial<Rules>=await import(modulePath).catch((error:NodeJS.ErrnoException)=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;
 return {};
});
function rule<K extends keyof Rules>(name:K):Rules[K]{
 const fn=rules[name];
 assert.equal(typeof fn,'function',`${name} must be exported`);
 return fn!;
}
const connected:TrialView=Object.freeze({level:'connected',startedOn:'2026-10-31',endsOn:'2026-11-30',extended:false,state:'active'});
const hosted:TrialView=Object.freeze({level:'hosted',startedOn:'2026-11-15',endsOn:'2026-12-15',extended:false,state:'active'});

test('venue levels have exact service floors',()=>{
 const allows=rule('levelAllows');
 const services:Service[]=['address_lookup','transactional_email','content_translation','continuous_backup',
  'retained_snapshots','remote_access','rota_solver','hosting'];
 assert.deepEqual(services.map(service=>allows('registered',service)),[true,true,false,false,false,false,false,false]);
 assert.deepEqual(services.map(service=>allows('connected',service)),[true,true,true,true,true,true,true,false]);
 assert.deepEqual(services.map(service=>allows('hosted',service)),[true,true,true,true,true,true,true,true]);
});

test('unknown levels and services never grant permission',()=>{
 const allows=rule('levelAllows');
 for(const level of ['registered','connected','hosted'] as const){
  for(const service of ['unknown','fiscal_allocation','toString','constructor','',null,undefined]){
   assert.equal(allows(level,service as Service),false,`${level}: ${service}`);
  }
 }
 for(const level of ['paid','free','unknown','toString','constructor','',null,undefined]){
  assert.equal(allows(level as BillingLevel,'address_lookup'),false,String(level));
  assert.equal(allows(level as BillingLevel,'hosting'),false,String(level));
 }
});

test('trial dates grant only the stored half open interval',()=>{
 const effective=rule('effectiveVenueLevel');
 assert.equal(effective('registered',[connected],'2026-10-30'),'registered');
 assert.equal(effective('registered',[connected],'2026-10-31'),'connected');
 assert.equal(effective('registered',[connected],'2026-11-29'),'connected');
 assert.equal(effective('registered',[connected],'2026-11-30'),'registered');
 const extended:TrialView={...connected,endsOn:'2026-12-30',extended:true};
 assert.equal(effective('registered',[extended],'2026-12-29'),'connected');
 assert.equal(effective('registered',[extended],'2026-12-30'),'registered');
});

test('lapsed and converted trials add no grant',()=>{
 const effective=rule('effectiveVenueLevel');
 for(const state of ['lapsed','converted'] as const){
  assert.equal(effective('registered',[{...connected,state}],'2026-11-01'),'registered',state);
  assert.equal(effective('connected',[{...hosted,state}],'2026-11-20'),'connected',state);
 }
});

test('the highest current level wins without rewriting the trial facts',()=>{
 const effective=rule('effectiveVenueLevel');
 const trials=Object.freeze([connected,hosted]);
 assert.equal(effective('registered',trials,'2026-11-20'),'hosted');
 assert.equal(effective('registered',[hosted,connected],'2026-11-20'),'hosted');
 assert.equal(effective('hosted',[connected],'2026-11-01'),'hosted');
 assert.equal(effective('connected',[hosted],'2026-12-15'),'connected');
 assert.equal(effective('registered',[],'2026-11-01'),'registered');
 assert.equal(effective('connected',[],'2026-11-01'),'connected');
 assert.equal(effective('hosted',[],'2026-11-01'),'hosted');
 assert.deepEqual(trials,[
  {level:'connected',startedOn:'2026-10-31',endsOn:'2026-11-30',extended:false,state:'active'},
  {level:'hosted',startedOn:'2026-11-15',endsOn:'2026-12-15',extended:false,state:'active'},
 ]);
});

test('payment scheduled and display facts cannot activate a trial',()=>{
 const effective=rule('effectiveVenueLevel');
 const displayFacts={...connected,state:'lapsed' as const,paymentMethod:'card',paymentState:'succeeded',
  scheduledLevel:'hosted',scheduledOn:'2026-11-01',displayState:'active',paidUntil:'2027-01-01'};
 assert.equal(effective('registered',[displayFacts],'2026-11-20'),'registered');
 assert.equal(rule('paidGrantWindow')('registered',[displayFacts],'2026-11-20'),null);
});

test('paid setup window ends at the first real grant gap',()=>{
 const window=rule('paidGrantWindow');
 const touching:TrialView={...hosted,startedOn:'2026-11-30',endsOn:'2026-12-30'};
 assert.deepEqual(window('registered',[connected,touching],'2026-11-01'),{until:'2026-12-30'});
 assert.deepEqual(window('registered',[touching,connected],'2026-11-01'),{until:'2026-12-30'});
 const gapped:TrialView={...touching,startedOn:'2026-12-01'};
 assert.deepEqual(window('registered',[gapped,connected],'2026-11-01'),{until:'2026-11-30'});
 assert.equal(window('registered',[gapped,connected],'2026-11-30'),null);
 assert.deepEqual(window('registered',[gapped,connected],'2026-12-01'),{until:'2026-12-30'});
});

test('overlapping paid windows extend coverage without shortening it',()=>{
 const window=rule('paidGrantWindow');
 const inside:TrialView={...hosted,startedOn:'2026-11-10',endsOn:'2026-11-20'};
 assert.deepEqual(window('registered',[inside,connected,hosted],'2026-11-01'),{until:'2026-12-15'});
 assert.deepEqual(window('registered',[hosted,inside,connected],'2026-11-20'),{until:'2026-12-15'});
 assert.deepEqual(window('registered',[{...connected,endsOn:'2026-12-30',extended:true},hosted],'2026-11-01'),
  {until:'2026-12-30'});
});

test('inactive future and expired trials cannot bridge a paid setup gap',()=>{
 const window=rule('paidGrantWindow');
 for(const state of ['lapsed','converted'] as const){
  assert.deepEqual(window('registered',[connected,{...hosted,state}],'2026-11-20'),{until:'2026-11-30'});
 }
 assert.equal(window('registered',[connected],'2026-10-30'),null);
 assert.equal(window('registered',[connected],'2026-11-30'),null);
 assert.equal(window('registered',[],'2026-11-01'),null);
 assert.deepEqual(window('registered',[{...connected,endsOn:'2026-12-30',extended:true}],'2026-12-29'),
  {until:'2026-12-30'});
 assert.equal(window('registered',[{...connected,endsOn:'2026-12-30',extended:true}],'2026-12-30'),null);
});

test('a paid base provides an unbounded setup window',()=>{
 const window=rule('paidGrantWindow');
 assert.deepEqual(window('connected',[],'2026-11-01'),{until:null});
 assert.deepEqual(window('hosted',[connected],'2026-11-30'),{until:null});
 assert.deepEqual(window('connected',[hosted],'2026-12-15'),{until:null});
});

test('civil dates admit leap days and the supported calendar endpoints',()=>{
 const effective=rule('effectiveVenueLevel');
 const leap:TrialView={...connected,startedOn:'2028-02-29',endsOn:'2028-03-01'};
 assert.equal(effective('registered',[leap],'2028-02-29'),'connected');
 assert.equal(effective('registered',[leap],'2028-03-01'),'registered');
 assert.equal(effective('registered',[],'0001-01-01'),'registered');
 assert.deepEqual(rule('paidGrantWindow')('hosted',[],'9999-12-31'),{until:null});
});

const invalid=(run:()=>unknown)=>assert.throws(run,{name:'BillingError',message:'invalid_billing_input',code:'invalid_billing_input'});
test('invalid today refuses before any positive permission',()=>{
 for(const today of ['','2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-01-00',
  '2026-1-01','2026-11-01T00:00:00Z',' 2026-11-01','0000-01-01','10000-01-01',null,undefined,42]){
  invalid(()=>rule('effectiveVenueLevel')('hosted',[],today as string));
  invalid(()=>rule('paidGrantWindow')('connected',[],today as string));
 }
});

test('malformed trial facts refuse even behind a paid base or a valid grant',()=>{
 const malformed:unknown[]=[null,[],{},
  {...connected,state:'pending'},{...connected,level:'registered'},{...connected,extended:'false'},
  {...connected,startedOn:'2026-11-30'},{...connected,startedOn:'2026-12-01'},
  {...connected,startedOn:'2026-02-29'},{...connected,endsOn:'2026-11-31'},
  {...connected,endsOn:'2026-11-30T00:00:00Z'},{...connected,startedOn:null}];
 for(const trial of malformed){
  invalid(()=>rule('effectiveVenueLevel')('hosted',[trial as TrialView],'2026-11-20'));
  invalid(()=>rule('effectiveVenueLevel')('registered',[hosted,trial as TrialView],'2026-11-20'));
  invalid(()=>rule('paidGrantWindow')('connected',[trial as TrialView],'2026-11-20'));
  invalid(()=>rule('paidGrantWindow')('registered',[hosted,trial as TrialView],'2026-11-20'));
 }
 for(const trials of [null,{},'active']){
  invalid(()=>rule('effectiveVenueLevel')('hosted',trials as unknown as TrialView[],'2026-11-20'));
  invalid(()=>rule('paidGrantWindow')('connected',trials as unknown as TrialView[],'2026-11-20'));
 }
});

test('unknown base facts refuse instead of returning a permission level',()=>{
 for(const base of ['paid','free','unknown','',null,undefined]){
  invalid(()=>rule('effectiveVenueLevel')(base as BillingLevel,[hosted],'2026-11-20'));
  invalid(()=>rule('paidGrantWindow')(base as BillingLevel,[hosted],'2026-11-20'));
 }
});
