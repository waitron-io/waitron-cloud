import {createHash} from 'node:crypto';
import {AccountHttpError} from './errors.ts';
import type {AccountRateLimiter} from './rate-limit.ts';

export function turnstileAction(path: string): 'signup' | 'password_reset' | undefined {
  if (path === '/api/account/signup/request') return 'signup';
  if (path === '/api/account/password-reset/request') return 'password_reset';
}

export async function verifyTurnstile(secret: string, hostname: string, action: string, token: string, fetcher = fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => {void reader?.cancel().catch(() => {});};
  controller.signal.addEventListener('abort', cancel, {once: true});
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      body: new URLSearchParams({secret, response: token}),
    });
    reader = response.body?.getReader();
    controller.signal.throwIfAborted();
    if (!response.ok || !reader) return false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const {done, value} = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) return false;
      chunks.push(value);
    }
    const result = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
    if (Array.isArray(result?.['error-codes']) && result['error-codes'].includes('invalid-input-secret'))
      console.error('Turnstile rejected the configured secret');
    return result?.success === true && result.hostname === hostname && result.action === action;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', cancel);
    cancel();
  }
}

export async function requireTurnstile(options: {
  limiter: AccountRateLimiter; ip: string; hostname: string; action: 'signup' | 'password_reset';
  token?: string; secret: string; fetcher?: typeof fetch;
}) {
  const {limiter, ip, hostname, action, token, secret, fetcher} = options;
  const refused = new AccountHttpError(400, 'browser_check_failed');
  if (!token?.trim() || token.length > 2048) throw refused;
  const allowance = await limiter.consume([{scope: 'turnstile-ip', subject: ip, limit: 20, windowSeconds: 900}]);
  if (!allowance.allowed || !await verifyTurnstile(secret, hostname, action, token, fetcher)) throw refused;
  // Cloudflare's replay state can lag between servers. Claim the token before spending mail allowances.
  const digest = createHash('sha256').update(token).digest('hex');
  const claim = await limiter.consume([{scope: 'turnstile-token', subject: digest, limit: 1, windowSeconds: 300}]);
  if (!claim.allowed) throw refused;
}
