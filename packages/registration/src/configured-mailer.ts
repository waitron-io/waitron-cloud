import { createLocalAccountMailer } from './local-mailer.ts';
import { createSmtpAccountMailer } from './smtp-mailer.ts';
export function configuredAccountMailer() {
  const env = process.env;
  const mode = env.CLOUD_MAIL_TRANSPORT ?? (env.NODE_ENV === 'production' ? undefined : 'local');
  if (mode === 'smtp') return createSmtpAccountMailer({host: env.CLOUD_SMTP_HOST ?? '',
    port: Number(env.CLOUD_SMTP_PORT ?? 465), user: env.CLOUD_SMTP_USER ?? '', password: env.CLOUD_SMTP_PASSWORD ?? '',
    from: env.CLOUD_MAIL_FROM ?? '', portalOrigin: env.CLOUD_PORTAL_ORIGIN ?? ''});
  if (mode === 'local' && env.NODE_ENV !== 'production') return createLocalAccountMailer({port: Number(env.MAILPIT_SMTP_PORT ?? 1125), portalOrigin: env.CLOUD_PORTAL_ORIGIN});
  throw new Error('Invalid email transport configuration');
}
