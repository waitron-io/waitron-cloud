import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { connect, type TLSSocket } from 'node:tls';
import nodemailer from 'nodemailer';
import { EmailDeliveryError, type EmailDeliveryContext, type EmailDeliveryReceipt } from './email-delivery.ts';
import { normaliseEmail, type AccountEmail, type AccountNotification } from './account-input.ts';
import { accountMail, type AccountMailKind } from './account-mail.ts';

export interface SmtpAccountMailConfig {
  host: string; port?: number; user: string; password: string; from: string;
  portalOrigin: string; timeoutMs?: number;
}
const hostname = (value: string) => typeof value === 'string' && value.length <= 253
  && value.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));

/** Explicit TLS relay configuration. A custom CA adds trust; it never disables certificate validation. */
export function createSmtpAccountMailer(config: SmtpAccountMailConfig, trust: {ca?: string | Buffer} = {}) {
  let origin: URL;
  const port = config.port ?? 465;
  const timeout = config.timeoutMs ?? 15000;
  try {
    origin = new URL(config.portalOrigin);
    if (!(hostname(config.host) || isIP(config.host)) || !Number.isInteger(port) || port < 1 || port > 65535
      || !Number.isInteger(timeout) || timeout < 1 || timeout > 15000
      || typeof config.user !== 'string' || !config.user || typeof config.password !== 'string' || !config.password
      || typeof config.from !== 'string' || normaliseEmail(config.from) !== config.from
      || origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || !hostname(origin.hostname) || !origin.hostname.includes('.') || isIP(origin.hostname)
      || origin.hostname.endsWith('.localhost') || origin.hostname.endsWith('.local')) throw new Error();
  } catch { throw new Error('Invalid production mail configuration'); }
  // Capture configuration so a caller cannot change the destination or credential during a send.
  const {host, user, password, from} = config;
  const ca = Buffer.isBuffer(trust.ca) ? Buffer.from(trust.ca) : trust.ca;
  const domain = from.split('@')[1]!;
  const send = async (kind: AccountMailKind, message: AccountEmail | AccountNotification, context?: EmailDeliveryContext): Promise<EmailDeliveryReceipt> => {
    if (!message || typeof message.email !== 'string' || normaliseEmail(message.email) !== message.email
      || (kind !== 'password_changed' && (!('token' in message) || !/^[A-Za-z0-9_-]{43}$/.test(message.token) || !Number.isFinite(Date.parse(message.expiresAt))))) throw new EmailDeliveryError('delivery_rejected');
    const deliveryId = context?.deliveryId ?? randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(deliveryId)) throw new EmailDeliveryError('delivery_rejected');
    const signal = context?.signal;
    if (signal?.aborted) throw new EmailDeliveryError('delivery_timeout');
    let socket: TLSSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let rejectAbort!: (error: EmailDeliveryError) => void;
    const abortPromise = new Promise<never>((_, reject) => {rejectAbort = reject;});
    const abort = () => {cancelled = true; socket?.destroy(); rejectAbort(new EmailDeliveryError('delivery_timeout'));};
    const transport = nodemailer.createTransport({host, port, secure: true, auth: {user, pass: password},
      logger: false, debug: false, transactionLog: false, disableFileAccess: true, disableUrlAccess: true,
      connectionTimeout: timeout, greetingTimeout: timeout, socketTimeout: timeout,
      getSocket(_options, callback) {
        if (cancelled) {callback(new EmailDeliveryError('delivery_timeout')); return;}
        let returned = false;
        const done = (error: Error | null) => {
          if (returned) return; returned = true;
          callback(error, error ? undefined : {connection: socket, secured: true});
        };
        socket = connect({host, port, servername: isIP(host) ? undefined : host, ca,
          rejectUnauthorized: true, minVersion: 'TLSv1.2'}, () => done(null));
        socket.on('error', error => done(error));
      },
    });
    try {
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(abort, timeout);
      const rendered = accountMail(origin, kind, message);
      const messageId = `<${deliveryId}@${domain}>`;
      const result = await Promise.race([abortPromise, transport.sendMail({from: {name: 'Waitron Cloud', address: from},
        to: {address: message.email, name: ''}, subject: rendered.subject, text: rendered.text, messageId})]);
      if (result.rejected.length || result.accepted.length !== 1) throw new EmailDeliveryError('delivery_rejected');
      return {transport: 'smtp', messageId};
    } catch (error) {
      if (cancelled) throw new EmailDeliveryError('delivery_timeout');
      throw classify(error);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      socket?.destroy(); transport.close();
    }
  };
  return {
    sendVerification: (message: AccountEmail, context?: EmailDeliveryContext) => send('verification', message, context),
    sendPasswordReset: (message: AccountEmail, context?: EmailDeliveryContext) => send('password_reset', message, context),
    sendPasswordChanged: (message: AccountNotification, context?: EmailDeliveryContext) => send('password_changed', message, context),
  };
}

function classify(error: unknown): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) return error;
  const info = error && typeof error === 'object' ? error as {code?: string; responseCode?: number} : {};
  if (info.code === 'EAUTH' || (info.code && /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(info.code))
    || [530, 534, 535].includes(info.responseCode ?? 0)) return new EmailDeliveryError('delivery_configuration');
  if (info.code === 'ETIMEDOUT') return new EmailDeliveryError('delivery_timeout');
  if (info.responseCode && info.responseCode >= 500 && info.responseCode < 600) return new EmailDeliveryError('delivery_rejected');
  if (info.responseCode && info.responseCode >= 400 && info.responseCode < 500) return new EmailDeliveryError('delivery_deferred');
  return new EmailDeliveryError('delivery_failed');
}
