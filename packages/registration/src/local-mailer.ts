import type { SignupMailer } from './signup.ts';
import type { PasswordRecoveryMailer } from './password-recovery.ts';
import type { AccountEmail } from './account-input.ts';
import nodemailer from 'nodemailer';

/** Development capture only; the SMTP host is fixed to loopback and has no production configuration. */
export function createLocalAccountMailer(options: {port?: number; portalOrigin?: string} = {}): SignupMailer & PasswordRecoveryMailer {
  const port = options.port ?? 1125;
  let origin: URL;
  try { origin = new URL(options.portalOrigin ?? 'http://localhost:3000'); }
  catch { throw new Error('Invalid local mail configuration'); }
  if (process.env.NODE_ENV === 'production' || !Number.isInteger(port) || port < 1 || port > 65535
    || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Invalid local mail configuration');
  }
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false,
    ignoreTLS: true, logger: false, debug: false, connectionTimeout: 5000, greetingTimeout: 5000,
    socketTimeout: 5000, disableFileAccess: true, disableUrlAccess: true });
  const send = async (email: string, subject: string, text: string) => {
    try { await transport.sendMail({ from: 'Waitron Cloud <cloud@example.test>', to: { address: email, name: '' }, subject, text }); }
    // SMTP errors can contain recipients or secrets; expose only a fixed diagnostic.
    catch { throw new Error('Local email delivery failed'); }
  };
  const action = (message: AccountEmail, path: string, subject: string) => {
    const link = new URL(path, origin);
    link.searchParams.set('token', message.token);
    return send(message.email, subject, [subject, '', link.href, '',
      `This single-use link expires at ${message.expiresAt}.`,
      'If you did not request this email, you can ignore it.'].join('\n'));
  };
  return {
    sendVerification: message => action(message, '/signup', 'Verify your Waitron Cloud email'),
    sendPasswordReset: message => action(message, '/reset-password', 'Reset your Waitron Cloud password'),
    sendPasswordChanged: message => send(message.email, 'Your Waitron Cloud password changed',
      'Your Waitron Cloud password has changed. Existing sessions have ended.\nIf you did not make this change, request another password reset.'),
  };
}
