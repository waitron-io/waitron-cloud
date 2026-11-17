import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchGuestMenuLanguage as match} from '../src/guest-menu-match.ts';

test('each preference tries exact, shortened and same-base matches before the next preference',()=>{
 for(const [preferences,offered,want] of [
  [['es-MX'],['en','es'],'es'],
  [['ca-ES-valencia'],['ca','ca-ES-valencia'],'ca-ES-valencia'],
  [['ca-Latn-ES-valencia'],['ca','ca-ES-valencia'],'ca'],
  [['en-AU'],['en-US','en-GB'],'en-US'],
  [['en-GB'],['en-US','en-GB'],'en-GB'],
  [['zh-Hant-TW'],['zh','zh-Hant'],'zh-Hant'],
  [['ca','es'],['es','ca-ES-valencia'],'ca-ES-valencia'],
  [['bad_tag','de','FR-u-nu-latn'],['en','fr'],'fr'],
  [['iw'],['en','he'],'he'],
  [['EN-us-u-ca-gregory'],['es','en-US'],'en-US'],
  [['*','','bad_tag','de'],['fr','en'],undefined],
  [[],['fr'],undefined],
  [['es'],[],undefined],
  [['ca-valencia'],['ca-ES-valencia','ca','es'],'ca'],
 ] as const)assert.equal(match(preferences,offered),want,JSON.stringify({preferences,offered}));
});
