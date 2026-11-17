import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guestMenuPreferences} from '../src/guest-menu-preferences.ts';

test('phone preferences keep descending positive weights and header order, excluding wildcards',()=>{
 assert.deepEqual(guestMenuPreferences('fr;q=0.5, EN-us, es;q=0.5, *;q=0.8, en;q=0'),['en-us','fr','es']);
 assert.deepEqual(guestMenuPreferences(' es-MX ; Q=0.900, fr;q=1.000, he;q=0., en;q=1. '),['fr','en','es-mx']);
});
test('missing or malformed header entries do not become guest preferences',()=>{
 for(const header of [undefined,'','en;q=2, es;q=-1, fr;q=0.1234, de;q=word, bad_tag, ca;foo=bar','en;q=0.5;extra=yes']){
  assert.deepEqual(guestMenuPreferences(header),[],String(header));
 }
});


test('long malformed ranges keep the landed parser’s bounded whitespace cost',()=>{
 const started=performance.now();
 for(const header of ['en'+' '.repeat(16*1024-3)+'x','en'+' '.repeat(8190)+';'+' '.repeat(8190)+'x'])
  for(let n=0;n<100;n++)assert.deepEqual(guestMenuPreferences(header),[]);
 assert.ok(performance.now()-started<500);
});
