import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {verifySync} from 'otplib';

export interface FactorKeys {activeKeyId: string; keys: Readonly<Record<string, string>>}
export interface FactorBinding {accountId: string; version: number; purpose: 'active' | 'pending'; pendingId?: string}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET = /^[A-Z2-7]{16,128}$/;
const validSecret = (value: unknown): value is string => typeof value === 'string' && SECRET.test(value);
function unavailable(): never {throw new Error('factor_unavailable');}
function associatedData(binding: FactorBinding, keyId: string): Buffer {
  if (!binding || typeof binding !== 'object' || !UUID.test(binding.accountId)
    || !Number.isSafeInteger(binding.version) || binding.version < 1
    || !['active', 'pending'].includes(binding.purpose)
    || Object.keys(binding).sort().join(',') !== (binding.purpose === 'pending'
      ? 'accountId,pendingId,purpose,version' : 'accountId,purpose,version')
    || binding.purpose === 'pending' && (typeof binding.pendingId !== 'string' || !UUID.test(binding.pendingId))) unavailable();
  return Buffer.from(JSON.stringify(['cloud-factor-v1', keyId, binding.accountId, binding.version,
    binding.purpose, binding.pendingId ?? null]), 'utf8');
}
function keyBytes(config: FactorKeys, id: string): Buffer {
  if (!config || typeof config !== 'object' || typeof config.activeKeyId !== 'string'
    || !KEY_ID.test(config.activeKeyId) || !config.keys || typeof config.keys !== 'object'
    || !Object.hasOwn(config.keys, config.activeKeyId) || !Object.hasOwn(config.keys, id)
    || !Object.entries(config.keys).every(([label, key]) => KEY_ID.test(label)
      && typeof key === 'string' && /^[0-9a-fA-F]{64}$/.test(key))) unavailable();
  return Buffer.from(config.keys[id]!, 'hex');
}
export function matchedTotpSteps(secret: string, code: string, nowMs: number): number[] {
  if (!validSecret(secret) || typeof code !== 'string' || !/^[0-9]{6}$/.test(code)
    || !Number.isSafeInteger(nowMs) || nowMs < 0) return [];
  const current = Math.floor(nowMs / 30_000);
  const matches: number[] = [];
  try {
    // Enumerate matches so a colliding code cannot bypass replay state through another step.
    for (const step of [current - 1, current, current + 1]) {
      if (step >= 0 && verifySync({secret, token: code, epoch: step * 30, period: 30,
        digits: 6, epochTolerance: 0}).valid) matches.push(step);
    }
    return matches;
  } catch {return [];}
}
export function encryptFactorSecret(secret: string, config: FactorKeys, binding: FactorBinding): string {
  if (!validSecret(secret)) unavailable();
  const id = config?.activeKeyId;
  const key = keyBytes(config, id);
  const aad = associatedData(binding, id);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', id, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')].join('.');
}
export function decryptFactorSecret(envelope: string, config: FactorKeys, binding: FactorBinding): string | null {
  try {
    if (typeof envelope !== 'string' || envelope.length > 512) return null;
    const parts = envelope.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1' || !KEY_ID.test(parts[1]!)) return null;
    const [nonce, tag, ciphertext] = parts.slice(2).map(part => {
      const bytes = Buffer.from(part, 'base64url');
      if (!/^[A-Za-z0-9_-]+$/.test(part) || bytes.toString('base64url') !== part) unavailable();
      return bytes;
    });
    if (nonce!.length !== 12 || tag!.length !== 16 || ciphertext!.length < 16 || ciphertext!.length > 128) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(config, parts[1]!), nonce!);
    decipher.setAAD(associatedData(binding, parts[1]!));
    decipher.setAuthTag(tag!);
    const secret = Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString('utf8');
    return validSecret(secret) ? secret : null;
  } catch {return null;}
}
