import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import type {EmailWorker, createLocalAccountMailer} from '@waitron-cloud/registration';

type Mailer = ReturnType<typeof createLocalAccountMailer>;
type Event = {kind?: string; result: string; ms: number};
const allowed = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value) ? value : 'other';
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? value : null;

export function createMailCapture(options: {pool: Pick<Pool, 'query'>; inbox: string; mailer: Mailer}) {
  const workerEvents: Event[] = [], smtpEvents: Event[] = [];
  const record = (events: Event[], result: string, started: number, kind?: string) => {
    events.push({...(kind ? {kind} : {}), result, ms: Math.round(performance.now() - started)});
    if (events.length > 20) events.shift();
  };
  function observe<T extends keyof Mailer>(method: T, kind: string): Mailer[T] {
    return (async (...args: Parameters<Mailer[T]>) => {
      const started = performance.now();
      try {
        const result = await (options.mailer[method] as (...args: Parameters<Mailer[T]>) => ReturnType<Mailer[T]>)(...args);
        record(smtpEvents, 'accepted', started, kind); return result;
      } catch (error) {record(smtpEvents, 'rejected', started, kind); throw error;}
    }) as Mailer[T];
  }
  async function diagnostic(boundary: object) {
    let outbox: unknown = 'unavailable';
    try {
      const query = {text: `SELECT kind, status, attempts, failures, last_error, transport,
        message_id IS NOT NULL AS has_message_id FROM email_outbox ORDER BY created_at, id LIMIT 20`, query_timeout: 1000};
      const {rows} = await options.pool.query<Record<string, unknown>>(query);
      // Allow only known states and counts; no row IDs, payloads, recipients or raw errors.
      outbox = rows.map(row => ({
        kind: allowed(row.kind, ['verification', 'password_reset', 'password_changed', 'service_alert']),
        status: allowed(row.status, ['pending', 'processing', 'sent', 'expired', 'cancelled', 'failed']),
        attempts: count(row.attempts), failures: count(row.failures),
        lastError: row.last_error === null ? null : allowed(row.last_error, ['payload_unavailable', 'attempts_exhausted',
          'delivery_failed', 'delivery_timeout', 'delivery_deferred', 'delivery_rejected', 'delivery_configuration']),
        transport: row.transport === null ? 'none' : allowed(row.transport, ['smtp']), hasMessageId: row.has_message_id === true,
      }));
    } catch { /* Diagnostics must preserve the lookup assertion even when the database is unavailable. */ }
    return `Mail capture: ${JSON.stringify({...boundary, worker: workerEvents, smtp: smtpEvents, outbox})}`;
  }
  return {
    mailer: {sendVerification: observe('sendVerification', 'verification'), sendPasswordReset: observe('sendPasswordReset', 'password_reset'),
      sendPasswordChanged: observe('sendPasswordChanged', 'password_changed'), sendServiceAlert: observe('sendServiceAlert', 'service_alert')},
    async runOnce(worker: Pick<EmailWorker, 'runOnce'>) {
      const started = performance.now();
      try {const handled = await worker.runOnce(); record(workerEvents, handled ? 'handled' : 'idle', started); return handled;}
      catch (error) {record(workerEvents, 'failed', started); throw error;}
    },
    async tokenFromMail(email: string, subject: string) {
      const response = await fetch(`${options.inbox}/api/v1/messages`);
      const list = await response.json() as {messages: {ID: string; Subject: string; To: {Address: string}[]}[]};
      const found = list.messages.find(message => message.Subject === subject && message.To.some(to => to.Address === email));
      const inbox = {status: response.status, listed: list.messages.length,
        subjectMatches: list.messages.filter(message => message.Subject === subject).length,
        recipientMatches: list.messages.filter(message => message.To.some(to => to.Address === email)).length,
        combinedMatches: list.messages.filter(message => message.Subject === subject && message.To.some(to => to.Address === email)).length};
      assert.ok(found, found ? undefined : await diagnostic({stage: 'listing', inbox}));
      const detail = await fetch(`${options.inbox}/api/v1/message/${found.ID}`);
      const mail = await detail.json() as {Text: string};
      const token = mail.Text.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
      assert.ok(token, token ? undefined : await diagnostic({stage: 'token', inbox, detailStatus: detail.status})); return token;
    },
  };
}
