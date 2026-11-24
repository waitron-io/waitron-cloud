import type {Pool, PoolClient} from 'pg';
import {transaction, type EmailOutbox} from '@waitron-cloud/registration';
import type {SignupLimits} from './config.ts';
import {AccountHttpError} from './errors.ts';
import type {AccountRateLimiter, RateRule} from './rate-limit.ts';

const publicMailDomains = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.es', 'hotmail.com', 'hotmail.es', 'live.com', 'live.es', 'msn.com',
  'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com',
]);

export async function admitSignup(client: PoolClient, limiter: AccountRateLimiter, limits: SignupLimits, ip: string, email: string) {
  const {day} = (await client.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day")).rows[0] as {day: string};
  const domain = email.split('@')[1]!;
  const daily = (scope: string, subject: string, limit: number): RateRule =>
    ({scope, subject: JSON.stringify([day, subject]), limit, windowSeconds: 86400});
  // Every completion locks the connection before the domain and the shared count.
  if (!(await limiter.consume([daily('signup-account-ip', ip, limits.accountsPerConnectionPerDay)], client)).allowed) {
    throw new AccountHttpError(429, 'signup_rate_limited');
  }
  if (!publicMailDomains.has(domain)
    && !(await limiter.consume([daily('signup-account-domain', domain, limits.accountsPerDomainPerDay)], client)).allowed) {
    throw new AccountHttpError(429, 'signup_domain_limited');
  }
  // The count only triggers a warning. Admission above never depends on fleet-wide activity.
  if ((await limiter.consume([daily('signup-volume', '*', limits.operatorWarningThreshold)], client)).allowed) return;
  if ((await limiter.consume([daily('signup-volume-warning', '*', 1)], client)).allowed) return day;
}

export async function warnAboutSignupVolume(pool: Pool, outbox: EmailOutbox, operator: string | undefined, day: string, threshold: number) {
  console.warn('Cloud sign-up volume exceeded', day, threshold);
  if (!operator) return;
  try {
    await transaction(pool, async client => {
      const recipient = (await client.query(`SELECT credential.email, preferences.locale FROM cloud_accounts account
        JOIN cloud_credentials credential ON credential.account_id = account.id
        LEFT JOIN account_alert_preferences preferences ON preferences.account_id = account.id
        WHERE account.id = $1 AND account.disabled_at IS NULL AND credential.email_verified_at IS NOT NULL`, [operator])).rows[0];
      if (recipient) await outbox.enqueue(client, 'operator_notice', {
        email: recipient.email, locale: recipient.locale ?? 'en', event: 'signup_volume', accountId: operator, day, threshold,
      });
    });
  } catch {
    // The sign-up is already committed. The preceding warning remains available in the account log.
  }
}
