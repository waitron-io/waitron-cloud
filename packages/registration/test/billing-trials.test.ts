import assert from 'node:assert/strict';
import {test} from 'node:test';
import {trialEnd,trialReminderDates,trialWasUsed,trialAllowanceTier,trialOutcome,mayStartTrial} from '../src/index.ts';
const unused={remoteTrafficDays:2,translationRuns:0,solverRuns:0};

test('a trial lasts 30 days and reminds a week before and on its last day',()=>{
 assert.equal(trialEnd('2026-10-31'),'2026-11-30');
 assert.deepEqual(trialReminderDates('2026-11-30'),['2026-11-23','2026-11-29']);
});
test('remote access counts as used on three different days; one translation or solver run counts',()=>{
 assert.equal(trialWasUsed(unused),false);
 assert.equal(trialWasUsed({...unused,remoteTrafficDays:3}),true);
 assert.equal(trialWasUsed({...unused,translationRuns:1}),true);
 assert.equal(trialWasUsed({...unused,solverRuns:1}),true);
});
test('only a trial with no payment method has the tighter allowances',()=>{
 assert.equal(trialAllowanceTier(false),'trial');
 assert.equal(trialAllowanceTier(true),'full');
});
test('an unused connected trial is extended once, even with a payment method on file',()=>{
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:true,usage:unused,alreadyExtended:false}),'extend');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:false,usage:unused,alreadyExtended:false}),'extend');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:false,usage:unused,alreadyExtended:true}),'lapse');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:true,usage:unused,alreadyExtended:true}),'convert');
});
test('a used trial converts with a payment method and lapses without one',()=>{
 const used={...unused,remoteTrafficDays:3};
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:true,usage:used,alreadyExtended:false}),'convert');
 assert.equal(trialOutcome({level:'connected',hasPaymentMethod:false,usage:used,alreadyExtended:false}),'lapse');
});
test('a hosted trial is never extended',()=>{
 assert.equal(trialOutcome({level:'hosted',hasPaymentMethod:false,usage:unused,alreadyExtended:false}),'lapse');
 assert.equal(trialOutcome({level:'hosted',hasPaymentMethod:true,usage:unused,alreadyExtended:false}),'convert');
});
test('each level can be tried once per venue, and not after paying for it',()=>{
 assert.equal(mayStartTrial('connected',{trialled:[],paid:[]}),true);
 assert.equal(mayStartTrial('connected',{trialled:['connected'],paid:[]}),false);
 assert.equal(mayStartTrial('connected',{trialled:[],paid:['connected']}),false);
 assert.equal(mayStartTrial('hosted',{trialled:['connected'],paid:['connected']}),true);
});
