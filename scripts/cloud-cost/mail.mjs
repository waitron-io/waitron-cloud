import { createServer, connect } from 'node:net';
import { once } from 'node:events';

const fail = () => { throw Error('Invalid cloud cost mail measurement'); };
const requireThat = value => { if (!value) fail(); };
const actions = { sendVerification: 'verification', sendPasswordReset: 'password_reset',
  sendPasswordChanged: 'password_changed', sendServiceAlert: 'service_alert' };

// Count the capture server's final SMTP replies independently of the mailer's promise.
// Only protocol state survives; addresses, headers, bodies and delivery IDs stay private.
export async function openMailMeasurement({ target, maxAttempts = 1000, timeoutMs = 3000, signal }) {
  let endpoint;
  try {
    endpoint = new URL(target);
    requireThat(endpoint.protocol === 'smtp:' && endpoint.hostname === '127.0.0.1' && endpoint.port !== ''
      && ['', '/'].includes(endpoint.pathname) && !endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password
      && Number(endpoint.port) >= 1 && Number(endpoint.port) <= 65535);
    requireThat(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000 && !signal?.aborted);
    requireThat(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 10000);
  } catch { fail(); }
  const sockets = new Set(), histories = new Map(), operations = [];
  const producer = { attempts: 0, accepted: 0, refused: 0, retried: 0 };
  const observer = { attempts: 0, accepted: 0, refused: 0 };
  let invalid = false, active, closing, closed = false;
  const poison = () => {
    invalid = true;
    for (const socket of sockets) socket.destroy();
    active?.cancel();
  };
  const server = createServer(client => {
    client.on('error', () => {});
    if (invalid || closing || !active || active.record) { poison(); client.destroy(); return; }
    const record = { outcome: null, done: null };
    let finish;
    record.done = new Promise(resolve => { finish = resolve; }); active.record = record;
    observer.attempts++;
    const upstream = connect(Number(endpoint.port), '127.0.0.1');
    for (const socket of [client, upstream]) sockets.add(socket);
    let pending = ['greeting'], data = false, uploaded = 0, multiline = null, recipients = 0;
    const lines = callback => {
      let buffer = '';
      return chunk => {
        try {
          buffer += chunk.toString('latin1');
          while (buffer.includes('\r\n')) {
            const end = buffer.indexOf('\r\n'); requireThat(end <= 16384);
            const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); callback(line);
          }
          requireThat(buffer.length <= 16384);
        } catch { poison(); }
      };
    };
    client.on('data', lines(line => {
      if (data) {
        uploaded += line.length + 2; requireThat(uploaded <= 1048576);
        if (line === '.') { data = false; pending.push('body'); }
        return;
      }
      const command = line.split(' ', 1)[0];
      requireThat(['EHLO', 'HELO', 'MAIL', 'RCPT', 'DATA', 'QUIT', 'RSET'].includes(command));
      requireThat(!record.outcome || command === 'QUIT');
      if (command === 'RCPT') requireThat(++recipients === 1);
      pending.push(command);
    }));
    upstream.on('data', lines(line => {
      const match = /^(\d{3})([ -])/.exec(line); requireThat(match && pending.length > 0);
      const code = Number(match[1]);
      requireThat(multiline === null || code === multiline);
      if (match[2] === '-') { multiline = code; return; }
      multiline = null;
      const command = pending.shift();
      if (code >= 400 && code <= 599) {
        requireThat(!record.outcome); record.outcome = 'refused'; observer.refused++;
      } else if (command === 'body') {
        requireThat(code === 250 && !record.outcome); record.outcome = 'accepted'; observer.accepted++;
      } else if (command === 'DATA') { requireThat(code === 354); data = true; }
      else requireThat(code === (command === 'greeting' ? 220 : command === 'QUIT' ? 221 : 250));
    }));
    upstream.on('error', poison);
    client.once('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.once('close', () => { sockets.delete(upstream); client.destroy(); finish(); });
    client.pipe(upstream); upstream.pipe(client);
  });
  server.on('error', poison);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  signal?.addEventListener('abort', poison, { once: true });
  if (signal?.aborted) poison();

  const wrapMailer = mailer => {
    try { requireThat(mailer && !invalid && !closing); } catch { poison(); fail(); }
    return Object.fromEntries(Object.entries(actions).map(([method, action]) => [method, async (message, context) => {
      let timer, observedRefusal = false;
      try {
        requireThat(!invalid && !closing && !active && !signal?.aborted && !context?.signal?.aborted && observer.attempts < maxAttempts
          && typeof mailer[method] === 'function' && typeof context?.deliveryId === 'string'
          && /^[a-f0-9-]{36}$/.test(context.deliveryId));
        const previous = histories.get(context.deliveryId);
        requireThat(!previous || previous.action === action);
        const ordinal = previous?.attempts ?? 0;
        histories.set(context.deliveryId, { action, attempts: ordinal + 1 });
        let cancel;
        const cancelled = new Promise((_, reject) => { cancel = () => reject(Error('Invalid cloud cost mail measurement')); });
        active = { cancel, record: null };
        const current = active;
        timer = setTimeout(poison, timeoutMs);
        context.signal?.addEventListener('abort', poison, { once: true });
        try {
          let receipt, failed = false;
          await Promise.race([cancelled, (async () => {
            try { receipt = await mailer[method](message, context); } catch { failed = true; }
            requireThat(current.record); await current.record.done;
          })()]);
          requireThat(!invalid && current.record?.outcome === (failed ? 'refused' : 'accepted'));
          const outcome = current.record.outcome;
          producer.attempts++; producer[outcome]++; if (ordinal > 0) producer.retried++;
          const row = operations.find(r => r.action === action && r.outcome === outcome && r.retryOrdinal === ordinal);
          if (row) row.attempts++; else operations.push({ action, outcome, retryOrdinal: ordinal, attempts: 1 });
          if (failed) { observedRefusal = true; throw Error('Captured email delivery refused'); }
          return receipt;
        } finally { clearTimeout(timer); context.signal?.removeEventListener('abort', poison); active = null; }
      } catch {
        // An observed SMTP refusal is valid evidence; all uncertain or unmatched outcomes poison it.
        if (observedRefusal && !invalid) throw Error('Captured email delivery refused');
        poison(); fail();
      }
    }]));
  };
  const close = () => {
    if (closing) return closing;
    if (active) poison();
    closing = (async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve)); signal?.removeEventListener('abort', poison);
      requireThat(!invalid && producer.attempts > 0 && producer.attempts === observer.attempts
        && producer.accepted === observer.accepted && producer.refused === observer.refused);
      closed = true;
    })();
    return closing;
  };
  const snapshot = () => {
    requireThat(closed && !invalid && !active);
    return structuredClone({ scope: 'captured-mail-operations', status: 'measured', reconciled: true,
      producer, observer, discrepancy: { attempts: 0, accepted: 0, refused: 0 }, operations,
      billing: { quantity: null, status: 'unknown' } });
  };
  return { port: server.address().port, wrapMailer, close, snapshot };
}
