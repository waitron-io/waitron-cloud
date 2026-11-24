import {accountRequest, type ApiResult, type BrowserChallenge} from './api.ts';

export async function checkEmailBrowser(form: string, signal: AbortSignal): Promise<ApiResult<string>> {
  const challenge = await accountRequest<BrowserChallenge>('/browser-check', {form}, signal);
  if (!challenge.ok) return challenge;

  const deadline = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  let worker: Worker | undefined;
  let abort: (() => void) | undefined;
  try {
    deadline.throwIfAborted();
    const solver = worker = new Worker('/api/account/browser-check.js');
    const proof = await new Promise<string>((resolve, reject) => {
      abort = () => reject(deadline.reason);
      deadline.addEventListener('abort', abort, {once: true});
      solver.onmessage = ({data}) => {
        if (data?.challenge === challenge.value.challenge && Number.isSafeInteger(data.nonce)) {
          resolve(JSON.stringify({challenge: data.challenge, nonce: data.nonce}));
        } else reject(new Error('Browser check failed'));
      };
      solver.onerror = () => reject(new Error('Browser check failed'));
      solver.postMessage(challenge.value);
    });
    return {ok: true, value: proof};
  } catch {
    return {ok: false, status: 403, code: 'browser_check_required', retryAfterMs: 0};
  } finally {
    if (abort) deadline.removeEventListener('abort', abort);
    worker?.terminate();
  }
}
