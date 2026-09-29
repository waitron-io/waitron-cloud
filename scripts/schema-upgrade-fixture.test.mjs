import assert from 'node:assert/strict';
import test from 'node:test';
import {digest} from './schema-upgrade-fixture.mjs';
test('operation receipt digest ignores PostgreSQL jsonb object key ordering',()=>{
 assert.equal(digest({lease:{payload:'same',signature:'same'},installationId:'same'}),digest({installationId:'same',lease:{signature:'same',payload:'same'}}));
 assert.notEqual(digest({items:['first','second']}),digest({items:['second','first']}));
});
