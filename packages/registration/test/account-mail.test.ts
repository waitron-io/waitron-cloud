import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountMail } from '../src/account-mail.ts';
const token = 'a'.repeat(43);
for (const locale of ['en', 'es'] as const) for (const kind of ['verification', 'password_reset', 'password_changed'] as const) {
  test(`${kind} renders ${locale} mail with private fragment links`, () => {
    const mail = accountMail(new URL('https://cloud.example'), kind, {
      email: 'owner@example.com', token, expiresAt: '2030-01-01T12:00:00.000Z', locale,
    });
    assert.match(mail.subject, locale === 'es' ? /tu|Tu/ : /your|Your/);
    if (kind === 'password_changed') { assert.doesNotMatch(mail.text, /token=/); return; }
    assert.ok(mail.text.includes(`#token=${token}&lang=${locale}`));
    assert.doesNotMatch(mail.text, /\?token=/);
    assert.match(mail.text, /UTC/);
  });
}
test('old queued payloads retain English', () => {
  const message = {email: 'owner@example.com', token, expiresAt: '2030-01-01T12:00:00Z'};
  assert.deepEqual(accountMail(new URL('https://cloud.example'), 'verification', message),
    accountMail(new URL('https://cloud.example'), 'verification', {...message, locale: 'en'}));
});
