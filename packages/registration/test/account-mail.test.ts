import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountMail } from '../src/account-mail.ts';
import { createLocalAccountMailer } from '../src/local-mailer.ts';
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
test('unsupported and inherited locale names are rejected before rendering any mail kind', () => {
  for (const locale of ['fr','toString','valueOf','hasOwnProperty','constructor',null])
    for (const kind of ['verification','password_reset','password_changed'] as const)
      assert.throws(()=>accountMail(new URL('https://cloud.example'),kind,
        {email:'owner@example.test',token,expiresAt:'2030-01-01T12:00:00Z',locale} as never),/Invalid account email/);
});
test('direct local-mailer rendering failures are asynchronous promise rejections', async () => {
  const mailer = createLocalAccountMailer();
  let sending: ReturnType<typeof mailer.sendVerification> | undefined;
  assert.doesNotThrow(() => {
    sending = mailer.sendVerification({
      email: 'owner@example.test', token, expiresAt: '2030-01-01T12:00:00Z', locale: 'fr',
    } as never);
  });
  await assert.rejects(sending!, /Invalid account email/);
});

for (const locale of ['en', 'es', undefined] as const) {
  test(`password_changed links to the reset request page in ${locale ?? 'legacy English'}`, () => {
    for (const origin of ['https://cloud.example', 'http://localhost:3000']) {
      const mail = accountMail(new URL(origin), 'password_changed', {
        email: 'owner@example.com', ...(locale === undefined ? {} : {locale}),
      });
      const links = mail.text.match(/https?:\/\/\S+/g);
      assert.deepEqual(links, [`${origin}/forgot-password#lang=${locale ?? 'en'}`]);
      assert.equal(mail.subject, locale === 'es'
        ? 'Tu contraseña de Waitron Cloud ha cambiado' : 'Your Waitron Cloud password changed');
      assert.doesNotMatch(mail.text, /token=/);
    }
  });
}
