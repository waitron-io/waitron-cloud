import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { EmailOutbox, EmailWorker } from '../../src/email-outbox.ts';
import { SignupStore, type SignupMailer } from '../../src/signup.ts';
import { PasswordRecoveryStore, type PasswordRecoveryMailer } from '../../src/password-recovery.ts';
export const testEmailKeys = {test: randomBytes(32).toString('hex')};
export const testOutbox = new EmailOutbox({activeKeyId: 'test', keys: testEmailKeys});
const unused = async () => {};
// Existing account behavior tests explicitly drain real queued delivery before checking their captures.
export function signupAndDeliver(pool: Pool, mailer: SignupMailer) {
  const store = new SignupStore(pool, testOutbox);
  const worker = new EmailWorker(pool, testOutbox, {sendPasswordReset: unused, sendPasswordChanged: unused, ...mailer});
  return {
    async request(email: string) { const result = await store.request(email); while (await worker.runOnce()) {} return result; },
    complete: store.complete.bind(store),
  };
}
export function recoveryAndDeliver(pool: Pool, mailer: PasswordRecoveryMailer) {
  const store = new PasswordRecoveryStore(pool, testOutbox);
  const worker = new EmailWorker(pool, testOutbox, {sendVerification: unused, ...mailer});
  return {
    async request(email: string) { const result = await store.request(email); while (await worker.runOnce()) {} return result; },
    async complete(token: string, password: string) { const result = await store.complete(token, password); while (await worker.runOnce()) {} return result; },
  };
}
