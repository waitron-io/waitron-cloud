import {browserCheckDifficulty, browserCheckLifetimeMs, browserCheckTokens, solvedBrowserCheck} from '@waitron-cloud/remote-access/browser-check';
import {AccountHttpError} from './errors.ts';
import type {AccountRateLimiter} from './rate-limit.ts';

export function isEmailRequest(path: string | undefined): path is '/signup/request' | '/password-reset/request' {
  return path === '/signup/request' || path === '/password-reset/request';
}

export function emailBrowserCheck(rateKey: string, origin: string, limiter: AccountRateLimiter) {
  const tokens = browserCheckTokens(Buffer.from(rateKey, 'hex'));
  const purpose = (form: string) => `email-browser-check:${form}`;
  return {
    issue(form: string | undefined, ip: string) {
      if (!isEmailRequest(form)) throw new AccountHttpError(400, 'invalid_input');
      return {challenge: tokens.issue(purpose(form), origin, ip, browserCheckLifetimeMs), difficulty: browserCheckDifficulty};
    },
    async spend(header: string | undefined, form: string, ip: string) {
      let proof: unknown;
      try {if (header && header.length <= 1100) proof = JSON.parse(header);} catch {}
      if (!solvedBrowserCheck(proof, browserCheckDifficulty, challenge => tokens.accepts(challenge, purpose(form), origin, ip))) {
        throw new AccountHttpError(403, 'browser_check_required');
      }
      // Keep the claim beyond the challenge lifetime so a live proof cannot become spendable again.
      const spent = await limiter.consume([{scope: 'email-browser-check-spent', subject: proof.challenge, limit: 1, windowSeconds: 300}]);
      if (!spent.allowed) throw new AccountHttpError(403, 'browser_check_required');
    },
  };
}
