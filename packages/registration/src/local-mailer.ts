import type {ServiceAlert,ServiceAlertMailer} from './service-alert.ts';
import type { SignupMailer } from './signup.ts';
import type { PasswordRecoveryMailer } from './password-recovery.ts';
import { accountMail, type AccountMailKind } from './account-mail.ts';
import type { AccountEmail, AccountNotification } from './account-input.ts';
import nodemailer from 'nodemailer';

/** Development capture only; the SMTP host is fixed to loopback and has no production configuration. */
export function createLocalAccountMailer(options: {port?: number; portalOrigin?: string} = {}): SignupMailer & PasswordRecoveryMailer & ServiceAlertMailer {
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
  const action = async (kind: AccountMailKind, message: AccountEmail | AccountNotification | ServiceAlert) => {
    const rendered = accountMail(origin, kind, message);
    await send(message.email, rendered.subject, rendered.text);
  };
  return {
    sendVerification: message => action('verification', message),
    sendPasswordReset: message => action('password_reset', message),
    sendPasswordChanged: message => action('password_changed', message),
    sendServiceAlert: message => action('service_alert', message),
  };
}
