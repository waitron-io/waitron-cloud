import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { transaction } from '@waitron-cloud/registration';
export interface RateRule { scope: string; subject: string; limit: number; windowSeconds: number; }
export interface RateDecision { allowed: boolean; retryAfterSeconds: number; }
export class AccountRateLimiter {
  readonly #pool: Pool;
  readonly #key: Buffer;
  constructor(pool: Pool, key: string) {
    if (typeof key !== 'string' || !/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('Invalid rate configuration');
    this.#pool = pool; this.#key = Buffer.from(key, 'hex');
  }
  async consume(rules: readonly RateRule[]): Promise<RateDecision> {
    if (!Array.isArray(rules) || !rules.length || rules.length > 8) throw new Error('Invalid rate rule');
    const entries = rules.map(rule => {
      if (!rule || typeof rule.scope !== 'string' || !rule.scope || rule.scope.length > 64
        || typeof rule.subject !== 'string' || !rule.subject || rule.subject.length > 1024
        || !Number.isInteger(rule.limit) || rule.limit < 1 || rule.limit > 1000000
        || !Number.isInteger(rule.windowSeconds) || rule.windowSeconds < 1 || rule.windowSeconds > 86400) throw new Error('Invalid rate rule');
      return {...rule, key: createHmac('sha256', this.#key).update(JSON.stringify([rule.scope, rule.subject])).digest('hex')};
    }).sort((a, b) => a.key.localeCompare(b.key));
    if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error('Invalid rate rule');
    return transaction(this.#pool, async client => {
      let retryAfterSeconds = 0;
      // Stable key order prevents overlapping multi-rule requests acquiring rows in reverse order.
      for (const rule of entries) {
        await client.query(`INSERT INTO account_rate_limits (key, attempts, expires_at) VALUES ($1, 0, clock_timestamp())
          ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key`, [rule.key]);
        // Read wall time after the upsert has acquired the row lock, including any contention wait.
        const row = (await client.query(`SELECT attempts, expires_at > clock_timestamp() AS live,
          GREATEST(1, ceil(extract(epoch FROM expires_at - clock_timestamp())))::integer AS wait
          FROM account_rate_limits WHERE key = $1`, [rule.key])).rows[0];
        const attempts = row.live ? Math.min(rule.limit + 1, row.attempts + 1) : 1;
        await client.query(`UPDATE account_rate_limits SET attempts = $2,
          expires_at = CASE WHEN $3 THEN expires_at ELSE clock_timestamp() + $4 * interval '1 second' END
          WHERE key = $1`, [rule.key, attempts, row.live, rule.windowSeconds]);
        if (attempts > rule.limit) retryAfterSeconds = Math.max(retryAfterSeconds, row.wait);
      }
      return {allowed: retryAfterSeconds === 0, retryAfterSeconds};
    });
  }
  async prune(): Promise<number> {
    const result = await this.#pool.query(`DELETE FROM account_rate_limits WHERE key IN
      (SELECT key FROM account_rate_limits WHERE expires_at <= clock_timestamp()
       ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`);
    return result.rowCount ?? 0;
  }
}
