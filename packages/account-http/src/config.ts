import { canonicalIp } from './client-address.ts';
import { isAbsolute } from 'node:path';
import { LocalPasswordCorpus, type PasswordScreeningProvider } from '@waitron-cloud/registration';
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
