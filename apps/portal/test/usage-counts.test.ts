import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as usage from '../src/usage-screen.ts';

for(const locale of ['en','es'] as const)for(const [decimal,en,es] of [
 ['0','0','0'],['1234','1,234','1234'],['12345','12,345','12.345'],
 ['9007199254740993','9,007,199,254,740,993','9.007.199.254.740.993'],
] as const)test(`${locale}: usage count ${decimal} preserves exact precision and language grouping`,()=>{
 assert.ok('formatCount' in usage,'usage count formatter is available');
 assert.equal(usage.formatCount(decimal,locale),locale==='en'?en:es);
});
