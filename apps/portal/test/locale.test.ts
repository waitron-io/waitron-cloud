import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseLocale, translations } from '../src/locale.ts';
test('saved explicit language wins, then first supported browser language, then English', () => {
  assert.equal(chooseLocale('es', ['en-US']), 'es');
  assert.equal(chooseLocale(null, ['fr', 'es-ES', 'en']), 'es');
  assert.equal(chooseLocale('fr', ['EN-gb', 'es']), 'en');
  assert.equal(chooseLocale(null, ['fr', 'de']), 'en');
});

for(const locale of ['en','es'] as const)test(`${locale}: size and format messages do not direct another submission`,()=>{
  const c=translations[locale];
  for(const context of ['account','factorSignIn','sessionRevoke','logout','alerts','snapshots','diagnostic','recovery','remote','usage'] as const)
    for(const cause of ['Size','Format'] as const)assert.equal(c[`${context}Request${cause}`],c[`requestBody${cause}`]);
});
