import type {Pool} from 'pg';

export const historyCleanupCategories = [
  'sessions',
  'signupRequests',
  'passwordResetRequests',
  'webauthnCeremonies',
  'pairingRequests',
  'registrationOperations',
  'emailDeliveries',
  'backupJobs',
  'recoveryHistory',
  'backupTombstones',
] as const;

export type HistoryCleanupCategory = typeof historyCleanupCategories[number];
export type HistoryCleanupPolicy = Readonly<{
  cutoffs: Readonly<Partial<Record<HistoryCleanupCategory, string>>>;
  chunkSize: number;
}>;
export type HistoryCleanupCategoryReport = Readonly<{
  cutoff: string;
  eligible: number;
  blocked: number;
  deleted: number;
  hasMore: boolean;
}>;
export type HistoryCleanupReport = Readonly<{
  schemaVersion: 1;
  mode: 'dry-run' | 'apply';
  chunkSize: number;
  categories: Readonly<Partial<Record<HistoryCleanupCategory, HistoryCleanupCategoryReport>>>;
}>;

const CATEGORY_SET = new Set<string>(historyCleanupCategories);
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const fail = (): never => { throw new Error('Invalid history cleanup policy'); };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function cutoff(value: unknown): string {
  if (typeof value !== 'string') return fail();
  const match = RFC3339.exec(value);
  if (!match) return fail();
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const fraction = (match[7] ?? '').padEnd(3, '0');
  const zone = match[8]!;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59))) return fail();
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second, Number(fraction)));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return fail();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fail();
  return parsed.toISOString();
}

export function parseHistoryCleanupPolicy(value: unknown): HistoryCleanupPolicy {
  if (!object(value) || !Object.keys(value).every(key => key === 'cutoffs' || key === 'chunkSize') || !object(value.cutoffs)) return fail();
  const entries = Object.entries(value.cutoffs);
  if (entries.some(([key]) => !CATEGORY_SET.has(key))) return fail();
  const cutoffs: Partial<Record<HistoryCleanupCategory, string>> = {};
  for (const [key, raw] of entries) cutoffs[key as HistoryCleanupCategory] = cutoff(raw);
  const chunkSize = value.chunkSize ?? 100;
  if (!Number.isInteger(chunkSize) || Number(chunkSize) < 1 || Number(chunkSize) > 1000) return fail();
  return Object.freeze({cutoffs: Object.freeze(cutoffs), chunkSize: Number(chunkSize)});
}

export class HistoryCleanup {
  readonly #pool: Pool;
  constructor(pool: Pool) { this.#pool = pool; }
  async run(policy: HistoryCleanupPolicy, options: {apply: boolean}): Promise<HistoryCleanupReport> {
    void this.#pool;
    const categories: Partial<Record<HistoryCleanupCategory, HistoryCleanupCategoryReport>> = {};
    for (const category of historyCleanupCategories) {
      const value = policy.cutoffs[category];
      if (value) categories[category] = {cutoff: value, eligible: 0, blocked: 0, deleted: 0, hasMore: false};
    }
    return {schemaVersion: 1, mode: options.apply ? 'apply' : 'dry-run', chunkSize: policy.chunkSize, categories};
  }
}
