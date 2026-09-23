import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseLocale } from '../src/locale.ts';
test('saved explicit language wins, then first supported browser language, then English', () => {
  assert.equal(chooseLocale('es', ['en-US']), 'es');
  assert.equal(chooseLocale(null, ['fr', 'es-ES', 'en']), 'es');
  assert.equal(chooseLocale('fr', ['EN-gb', 'es']), 'en');
  assert.equal(chooseLocale(null, ['fr', 'de']), 'en');
});
