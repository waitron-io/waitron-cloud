import { canonicalIp } from './client-address.ts';
import { isAbsolute } from 'node:path';
import { LocalPasswordCorpus, type PasswordScreeningProvider } from '@waitron-cloud/registration';
import type {FactorKeys} from '@waitron-cloud/identity';
import type {PasswordLoginPolicy,FactorManagementPolicy} from '@waitron-cloud/registration';
export interface FactorLimit {limit: number; windowSeconds: number}
export interface FactorPolicy extends PasswordLoginPolicy, FactorManagementPolicy {
  loginAccount: FactorLimit;
  completeIp: FactorLimit;
  completeAccount: FactorLimit;
  completeChallenge: FactorLimit;
  manageIp: FactorLimit;
  manageAccount: FactorLimit;
}
export interface FactorConfig {keys: FactorKeys | null; policy: FactorPolicy | null}
const factorLimits = ['loginAccount', 'completeIp', 'completeAccount', 'completeChallenge', 'manageIp', 'manageAccount'] as const;
function object(value: unknown): value is Record<string, unknown> {return !!value && typeof value === 'object' && !Array.isArray(value);}
function positive(value: unknown, max: number) {return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max;}
export function validateFactorConfig(config: FactorConfig): FactorConfig {
  let keys: FactorKeys | null = null, policy: FactorPolicy | null = null;
  const suppliedKeys = config.keys, suppliedPolicy = config.policy;
  if (suppliedKeys && typeof suppliedKeys.activeKeyId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(suppliedKeys.activeKeyId)
    && object(suppliedKeys.keys) && Object.hasOwn(suppliedKeys.keys, suppliedKeys.activeKeyId)
    && Object.entries(suppliedKeys.keys).every(([id, key]) => /^[A-Za-z0-9_-]{1,64}$/.test(id)
      && typeof key === 'string' && /^[A-Fa-f0-9]{64}$/.test(key))) {
    keys = Object.freeze({activeKeyId: suppliedKeys.activeKeyId, keys: Object.freeze({...suppliedKeys.keys})});
  }
  const fields = ['loginLifetimeMs', 'pendingLifetimeMs', 'challengeAttempts', 'enrolmentAttempts', ...factorLimits];
  if (object(suppliedPolicy) && Object.keys(suppliedPolicy).length === fields.length && fields.every(field => Object.hasOwn(suppliedPolicy, field))
    && positive(suppliedPolicy.loginLifetimeMs, 300000) && positive(suppliedPolicy.pendingLifetimeMs, 300000)
    && positive(suppliedPolicy.challengeAttempts, 2147483647) && positive(suppliedPolicy.enrolmentAttempts, 2147483647)
    && factorLimits.every(field => object(suppliedPolicy[field]) && Object.keys(suppliedPolicy[field]).length === 2
      && Object.hasOwn(suppliedPolicy[field], 'limit') && Object.hasOwn(suppliedPolicy[field], 'windowSeconds')
      && positive(suppliedPolicy[field].limit, 1000000) && positive(suppliedPolicy[field].windowSeconds, 86400))) {
    policy = Object.freeze({...suppliedPolicy, ...Object.fromEntries(factorLimits.map(field => [field, Object.freeze({...suppliedPolicy[field]})]))});
  }
  return {keys,policy};
}
export function factorConfigFromEnv(env: NodeJS.ProcessEnv): FactorConfig {
  let keys: FactorKeys | null = null, policy: FactorPolicy | null = null;
  try {keys = {activeKeyId: env.CLOUD_FACTOR_ACTIVE_KEY_ID!, keys: JSON.parse(env.CLOUD_FACTOR_KEYS!)};} catch {}
  try {policy = JSON.parse(env.CLOUD_FACTOR_POLICY!);} catch {}
  // A factor configuration outage must leave no-factor login, passkeys and live account access available.
  return validateFactorConfig({keys,policy});
}
export interface AccountHttpConfig { portalOrigin: string; production: boolean; rateKey: string; trustedProxyIps: readonly string[]; }
export function validateConfig(config: AccountHttpConfig): Readonly<AccountHttpConfig> {
  try {
    const origin = new URL(config.portalOrigin);
    if (typeof config.production !== 'boolean' || !/^[0-9a-fA-F]{64}$/.test(config.rateKey)
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || !['https:', 'http:'].includes(origin.protocol)
      || (origin.protocol === 'http:' && (config.production || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
      || !Array.isArray(config.trustedProxyIps)) throw new Error();
    const trustedProxyIps = Object.freeze(config.trustedProxyIps.map(canonicalIp));
    return Object.freeze({portalOrigin: origin.origin, production: config.production, rateKey: config.rateKey, trustedProxyIps});
  } catch { throw new Error('Invalid account HTTP configuration'); }
}
export function accountHttpConfig(env: NodeJS.ProcessEnv): AccountHttpConfig {
  return validateConfig({portalOrigin: env.CLOUD_PORTAL_ORIGIN ?? '', production: env.NODE_ENV === 'production',
    rateKey: env.CLOUD_HTTP_RATE_KEY ?? '', trustedProxyIps: env.CLOUD_HTTP_TRUSTED_PROXY_IPS ? env.CLOUD_HTTP_TRUSTED_PROXY_IPS.split(',').map(value => value.trim()) : []});
}

export function passwordCorpusPath(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.CLOUD_COMPROMISED_PASSWORD_CORPUS;
  if (value === undefined && env.NODE_ENV !== 'production') return undefined;
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 4096
    || value.includes('\0') || !isAbsolute(value)) throw new Error('Invalid compromised-password configuration');
  return value;
}

export async function passwordScreeningFromEnv(env: NodeJS.ProcessEnv): Promise<PasswordScreeningProvider | undefined> {
  const path = passwordCorpusPath(env);
  return path ? LocalPasswordCorpus.load(path) : undefined;
}
