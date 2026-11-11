import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseLocale, translations } from '../src/locale.ts';
test('saved explicit language wins, then first supported browser language, then English', () => {
  assert.equal(chooseLocale('es', ['en-US']), 'es');
  assert.equal(chooseLocale(null, ['fr', 'es-ES', 'en']), 'es');
  assert.equal(chooseLocale('fr', ['EN-gb', 'es']), 'en');
  assert.equal(chooseLocale(null, ['fr', 'de']), 'en');
});

for(const locale of ['en','es'] as const)test(`${locale}: size and format messages offer only a different read`,()=>{
  const c=translations[locale];
  for(const context of ['account','accountCreate','accountReset','accountPassword','factorSignIn','factorVerify','sessionRevoke','sessionSignOut','logout','alerts','snapshots','diagnostic','recovery','recoveryInspect','remote','usage'] as const)
    for(const cause of ['Size','Format'] as const)assert.equal(c[`${context}Request${cause}`],c[`requestBody${cause}`]);
  for(const [context,action] of [['factor','factorRefresh'],['installations','refreshStatus'],['translationConsent','translationConsentRefresh']] as const)
    for(const cause of ['Size','Format'] as const)assert.equal(c[`${context}Request${cause}`],`${c[`requestBody${cause}`]} ${c[action]}.`);
});
