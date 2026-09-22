import { randomBytes } from 'node:crypto';
import { createLocalAccountMailer } from './local-mailer.ts';

const mailer = createLocalAccountMailer({
  port: Number(process.env.MAILPIT_SMTP_PORT ?? 1125),
  portalOrigin: process.env.CLOUD_PORTAL_ORIGIN ?? 'http://localhost:3000',
});
const message = () => ({ email: 'cafe-owner@example.test', token: randomBytes(32).toString('base64url'),
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
await mailer.sendVerification(message());
await mailer.sendPasswordReset(message());
await mailer.sendPasswordChanged({ email: 'cafe-owner@example.test' });
console.log(`Three preview emails captured. Open http://localhost:${process.env.MAILPIT_UI_PORT ?? 8125}`);
console.log('Preview links use sample tokens; account screens are not served yet.');
