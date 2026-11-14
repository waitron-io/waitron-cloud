import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isGuestMenuLanguage,isGuestMenuLanguageShape} from '../src/guest-menu-language.ts';
test('menu languages preserve named canonical keys rather than normalising aliases',()=>{
 for(const value of ['en','es','ca','gl','ca-ES-valencia','fr','fil'])assert.equal(isGuestMenuLanguage(value),true,value);
 for(const value of ['xx','iw','eng','FR','en-US','ca-es-valencia','und','mul','zxx','bad_tag','',null,12])assert.equal(isGuestMenuLanguage(value),false,String(value));
});
test('portal language shape needs no runtime language-name catalogue',t=>{
 t.mock.method(Intl,'DisplayNames',()=>{throw Error('no catalogue');});
 for(const value of ['ca-ES-valencia','fr','xx'])assert.equal(isGuestMenuLanguageShape(value),true,value);
 for(const value of ['FR','en-US','bad_tag','',null])assert.equal(isGuestMenuLanguageShape(value),false,String(value));
});
