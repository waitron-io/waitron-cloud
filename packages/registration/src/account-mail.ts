import { validLocale, type AccountEmail, type AccountNotification } from './account-input.ts';
export type AccountMailKind = 'verification' | 'password_reset' | 'password_changed';
const copy = {
  en: {
    verification: 'Verify your Waitron Cloud email', password_reset: 'Reset your Waitron Cloud password',
    password_changed: 'Your Waitron Cloud password changed',
    changed: 'Your Waitron Cloud password has changed. Existing sessions have ended.\nIf you did not make this change, request another password reset.',
    expiry: 'This single-use link expires at', ignore: 'If you did not request this email, you can ignore it.',
  },
  es: {
    verification: 'Verifica tu correo de Waitron Cloud', password_reset: 'Restablece tu contraseña de Waitron Cloud',
    password_changed: 'Tu contraseña de Waitron Cloud ha cambiado',
    changed: 'Tu contraseña de Waitron Cloud ha cambiado. Se han cerrado las sesiones existentes.\nSi no has realizado este cambio, solicita otro restablecimiento de contraseña.',
    expiry: 'Este enlace de un solo uso caduca el', ignore: 'Si no has solicitado este correo, puedes ignorarlo.',
  },
};
export function accountMail(origin: URL, kind: AccountMailKind, message: AccountEmail | AccountNotification): {subject: string; text: string} {
  if (message.locale !== undefined && !validLocale(message.locale)) throw new Error('Invalid account email');
  const locale = message.locale ?? 'en';
  const text = copy[locale];
  if (kind === 'password_changed') return {subject: text.password_changed, text: text.changed};
  if (!('token' in message)) throw new Error('Invalid account email');
  const link = new URL(kind === 'verification' ? '/signup' : '/reset-password', origin);
  link.hash = new URLSearchParams({token: message.token, lang: locale}).toString();
  const expiry = new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC'}).format(new Date(message.expiresAt));
  return {subject: text[kind], text: [text[kind], '', link.href, '', `${text.expiry} ${expiry}.`, text.ignore].join('\n')};
}
