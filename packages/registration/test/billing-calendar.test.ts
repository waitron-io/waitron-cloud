import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addDays,renewalDateIn,nextRenewalAfter,renewalOnOrAfter,firstAttemptDate,firstChargedRenewal,failureTimeline,refundTimeline} from '../src/index.ts';

test('days are added across month and year ends, forwards and back',()=>{
 assert.equal(addDays('2026-12-28',7),'2027-01-04');
 assert.equal(addDays('2028-03-01',-1),'2028-02-29');
});
test('a renewal day of the 29th to the 31st falls on the last day of a shorter month',()=>{
 assert.equal(renewalDateIn(31,2027,2),'2027-02-28');
 assert.equal(renewalDateIn(31,2028,2),'2028-02-29');
 assert.equal(renewalDateIn(30,2027,4),'2027-04-30');
 assert.equal(renewalDateIn(31,2027,3),'2027-03-31');
});
test('the next renewal is strictly after the given day and returns to the anchor day',()=>{
 assert.equal(nextRenewalAfter(12,'2026-11-11'),'2026-11-12');
 assert.equal(nextRenewalAfter(12,'2026-11-12'),'2026-12-12');
 assert.equal(nextRenewalAfter(31,'2027-01-31'),'2027-02-28');
 assert.equal(nextRenewalAfter(31,'2027-02-28'),'2027-03-31');
});
test('a renewal on or after a day includes that day itself',()=>{
 assert.equal(renewalOnOrAfter(12,'2026-11-12'),'2026-11-12');
 assert.equal(renewalOnOrAfter(12,'2026-11-13'),'2026-12-12');
 assert.equal(renewalOnOrAfter(31,'2027-02-28'),'2027-02-28');
});
test('cards are first tried 7 days ahead and direct debit 10, never before today',()=>{
 assert.equal(firstAttemptDate('2026-12-12','card','2026-11-20'),'2026-12-05');
 assert.equal(firstAttemptDate('2026-12-12','direct_debit','2026-11-20'),'2026-12-02');
 assert.equal(firstAttemptDate('2026-12-12','direct_debit','2026-12-09'),'2026-12-09');
 assert.equal(firstAttemptDate('2026-12-12','card','2026-12-12'),'2026-12-12');
});
test('a venue is first charged on the first renewal attempted after it becomes chargeable',()=>{
 assert.equal(firstChargedRenewal(null,'2026-11-30','card'),'2026-11-30');
 assert.equal(firstChargedRenewal(12,'2026-11-30','card'),'2026-12-12');
 assert.equal(firstChargedRenewal(12,'2026-12-12','card'),'2027-01-12');
 assert.equal(firstChargedRenewal(12,'2026-12-02','direct_debit'),'2026-12-12');
 assert.equal(firstChargedRenewal(12,'2026-12-03','direct_debit'),'2027-01-12');
});
test('level 2 stops on the renewal date; a card is retried 4 days and 1 day before it',()=>{
 assert.deepEqual(failureTimeline('connected','card','2026-12-12','2026-12-05'),
  {retryDates:['2026-12-08','2026-12-11'],servicesStop:'2026-12-12'});
 assert.deepEqual(failureTimeline('connected','card','2026-12-12','2026-12-08'),
  {retryDates:['2026-12-11'],servicesStop:'2026-12-12'});
 assert.deepEqual(failureTimeline('connected','card','2026-12-12','2026-12-11'),
  {retryDates:[],servicesStop:'2026-12-12'});
});
test('level 2 by direct debit is never retried before the renewal date',()=>{
 assert.deepEqual(failureTimeline('connected','direct_debit','2026-12-12','2026-12-08'),
  {retryDates:[],servicesStop:'2026-12-12'});
});
test('a hosted venue gets weekly retries for 30 days after the renewal date, then hosting stops',()=>{
 assert.deepEqual(failureTimeline('hosted','card','2026-12-12','2026-12-05'),
  {retryDates:['2026-12-12','2026-12-19','2026-12-26','2027-01-02','2027-01-09'],servicesStop:'2027-01-11'});
 assert.deepEqual(failureTimeline('hosted','card','2026-12-12','2026-12-06'),
  {retryDates:['2026-12-13','2026-12-20','2026-12-27','2027-01-03','2027-01-10'],servicesStop:'2027-01-11'});
 assert.deepEqual(failureTimeline('hosted','card','2026-12-12','2026-12-07'),
  {retryDates:['2026-12-14','2026-12-21','2026-12-28','2027-01-04'],servicesStop:'2027-01-11'});
});
test('a hosted venue by direct debit is retried 14 days apart and never within 10 days of hosting stopping',()=>{
 assert.deepEqual(failureTimeline('hosted','direct_debit','2026-12-12','2026-12-08'),
  {retryDates:['2026-12-22'],servicesStop:'2027-01-11'});
 assert.deepEqual(failureTimeline('hosted','direct_debit','2026-12-12','2026-12-18'),
  {retryDates:['2027-01-01'],servicesStop:'2027-01-11'});
});
test('a refunded direct debit starts the countdown a week after we learn of it',()=>{
 assert.deepEqual(refundTimeline('connected','card','2027-01-20'),
  {retryDates:['2027-01-23','2027-01-26'],servicesStop:'2027-01-27'});
 assert.equal(refundTimeline('hosted','direct_debit','2027-01-20').servicesStop,'2027-02-26');
});
