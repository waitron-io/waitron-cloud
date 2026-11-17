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
  [['ca'],['es','ca-ES-valencia'],'ca-ES-valencia'],
  [['en'],['es','en-US'],'en-US'],
  [['en-US'],['en','en-US'],'en-US'],
  [['en-GB','es'],['es','en-US'],'en-US'],
  [['en-GB'],['es','en-US','en'],'en'],
  [['ca-Latn-ES-valencia'],['es','ca-Latn-ES'],'ca-Latn-ES'],
  [['ca-ES-valencia'],['es','ca'],'ca'],
  [['ca-valencia'],['es','ca-ES-valencia','ca'],'ca'],
  [['fr'],['es','en'],undefined],
  [['','invalid_tag','*','EN-us-u-nu-latn'],['es','en-US'],'en-US'],
  [['de','en'],['en','de'],'de'],
  [['en-AU'],['en-GB','en-US'],'en-GB'],
  [[],['es','en'],undefined],
  [['en'],[],undefined],
 ] as const)assert.equal(match(preferences,offered),want,JSON.stringify({preferences,offered}));
});
