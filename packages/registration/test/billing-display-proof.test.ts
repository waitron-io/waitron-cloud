import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as api from '../src/index.ts';

// A missing package boundary must not prevent the adapter from projecting an owned venue.
test('package consumers project a registered venue at country midnight',()=>{
 const module=api as Record<string,any>;
 assert.equal(typeof module.projectBillingDisplay,'function','billing display package export must exist');
 const today=module.billingDisplayDay('2026-10-31T23:00:00.000Z','Europe/Madrid');
 assert.equal(today,'2026-11-01');
 assert.deepEqual(module.projectBillingDisplay({venue:{organisationId:'org',legalBusinessId:'business',venueId:'venue',revision:0,level:'registered',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null},trials:[],charges:[]},today),{status:'ready',level:'registered',state:'active',period:null});
});
