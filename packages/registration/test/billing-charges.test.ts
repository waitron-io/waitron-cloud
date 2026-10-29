import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hostedDaysCents,renewalLines,chargeTotals,type VenueChargeView} from '../src/index.ts';
const prices={connectedMonthlyCents:1000,hostedMonthlyCents:3000};
const venue=(venueId:string,over:Partial<VenueChargeView>={}):VenueChargeView=>({venueId,connectedFrom:'2026-11-12',hostedDays:0,hostedDaysCoveredByConnected:0,...over});

test('a level-2 venue that fails over pays only the difference for each hosted day',()=>{
 assert.equal(hostedDaysCents(prices,7,7),467);
});
test('a venue hosted from the start pays a thirtieth of the hosted price a day',()=>{
 assert.equal(hostedDaysCents(prices,30,0),3000);
 assert.equal(hostedDaysCents(prices,1,0),100);
});
test('the hosted amount is never negative',()=>{
 assert.equal(hostedDaysCents({connectedMonthlyCents:3000,hostedMonthlyCents:1000},2,2),0);
});
test('a venue whose paid month starts on this renewal date is charged on it',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('b',{connectedFrom:'2026-12-12'})]),
  [{venueId:'b',kind:'connected_month',quantity:1,cents:1000}]);
});
test('a venue still in its trial or free days is not charged',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('b',{connectedFrom:'2027-01-12'}),venue('c',{connectedFrom:null})]),[]);
});
test('one renewal carries each venue’s month and its hosted days, in venue order',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('b',{hostedDays:7,hostedDaysCoveredByConnected:7}),venue('a')]),[
  {venueId:'a',kind:'connected_month',quantity:1,cents:1000},
  {venueId:'b',kind:'connected_month',quantity:1,cents:1000},
  {venueId:'b',kind:'hosted_days',quantity:7,cents:467},
 ]);
});
test('a fresh hosted venue is charged its hosted days alone',()=>{
 assert.deepEqual(renewalLines('2026-12-12',prices,[venue('h',{connectedFrom:null,hostedDays:30})]),
  [{venueId:'h',kind:'hosted_days',quantity:30,cents:3000}]);
});
test('VAT is added once on the charge total, rounded half up',()=>{
 const lines=renewalLines('2026-12-12',prices,[venue('b',{hostedDays:7,hostedDaysCoveredByConnected:7}),venue('a')]);
 assert.deepEqual(chargeTotals(lines,2100),{netCents:2467,vatCents:518,grossCents:2985});
 assert.deepEqual(chargeTotals([],2100),{netCents:0,vatCents:0,grossCents:0});
});
