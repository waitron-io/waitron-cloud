import type { AccountLocale } from '../../src/account-input.ts';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { EmailOutbox, EmailWorker } from '../../src/email-outbox.ts';
import { SignupStore, type SignupMailer } from '../../src/signup.ts';
import { PasswordRecoveryStore, type PasswordRecoveryMailer } from '../../src/password-recovery.ts';
import type { PasswordScreeningProvider } from '../../src/compromised-passwords.ts';
export const testEmailKeys = {test: randomBytes(32).toString('hex')};
export const testOutbox = new EmailOutbox({activeKeyId: 'test', keys: testEmailKeys});
const unused = async () => {};
// Existing account behavior tests explicitly drain real queued delivery before checking their captures.
export function signupAndDeliver(pool: Pool, mailer: SignupMailer, screening?: PasswordScreeningProvider) {
  const store = new SignupStore(pool, testOutbox, screening);
  const worker = new EmailWorker(pool, testOutbox, {sendServiceAlert: unused, sendPasswordReset: unused, sendPasswordChanged: unused, ...mailer});
  return {
    async request(email: string, locale?: AccountLocale) { const result = await store.request(email, locale); while (await worker.runOnce()) {} return result; },
    complete: store.complete.bind(store),
  };
}
export function recoveryAndDeliver(pool: Pool, mailer: PasswordRecoveryMailer, screening?: PasswordScreeningProvider) {
  const store = new PasswordRecoveryStore(pool, testOutbox, screening);
  const worker = new EmailWorker(pool, testOutbox, {sendServiceAlert: unused, sendVerification: unused, ...mailer});
  return {
    async request(email: string, locale?: AccountLocale) { const result = await store.request(email, locale); while (await worker.runOnce()) {} return result; },
    async complete(token: string, password: string, locale?: AccountLocale) { const result = await store.complete(token, password, locale); while (await worker.runOnce()) {} return result; },
  };
}
