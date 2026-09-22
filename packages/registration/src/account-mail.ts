import type { AccountEmail } from './account-input.ts';
export type AccountMailKind = 'verification' | 'password_reset' | 'password_changed';
export function accountMail(origin: URL, kind: AccountMailKind, message: AccountEmail | {email: string}): {subject: string; text: string} {
  if (kind === 'password_changed') return {subject: 'Your Waitron Cloud password changed',
    text: 'Your Waitron Cloud password has changed. Existing sessions have ended.\nIf you did not make this change, request another password reset.'};
  if (!('token' in message)) throw new Error('Invalid account email');
  const subject = kind === 'verification' ? 'Verify your Waitron Cloud email' : 'Reset your Waitron Cloud password';
  const link = new URL(kind === 'verification' ? '/signup' : '/reset-password', origin);
  link.searchParams.set('token', message.token);
  return {subject, text: [subject, '', link.href, '', `This single-use link expires at ${message.expiresAt}.`,
    'If you did not request this email, you can ignore it.'].join('\n')};
}
