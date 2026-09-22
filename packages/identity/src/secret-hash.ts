import crypto from 'node:crypto';

// Source and adaptation details are recorded in ../SOURCE.md.
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const HASH_FORMAT = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
export function isSecretHash(stored: string): boolean { return typeof stored === 'string' && HASH_FORMAT.test(stored); }
function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, KEY_BYTES, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await derive(secret, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const match = HASH_FORMAT.exec(stored);
  if (!match) return false;
  const expected = Buffer.from(match[2]!, 'hex');
  const actual = await derive(secret, Buffer.from(match[1]!, 'hex'));
  return crypto.timingSafeEqual(expected, actual);
}
