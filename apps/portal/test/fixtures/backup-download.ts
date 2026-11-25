import {createCipheriv, createHash, scryptSync} from 'node:crypto';
import {gzipSync} from 'node:zlib';

export const recoveryKey = 'k'.repeat(43);
export const venueDatabase = Buffer.from('SQLite format 3\0synthetic venue rows');
const frame = Buffer.concat([Buffer.from('WBK1\x01'), Buffer.alloc(16, 42), Buffer.alloc(12, 24)]);
const key = scryptSync(recoveryKey, frame.subarray(5, 21), 32, {N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 ** 2});

export function backupBytes({gzip = false, oversized = false, database = venueDatabase} = {}) {
  const entry = (name: string, bytes: Buffer, size = BigInt(bytes.length)) => {
    const nameLength = Buffer.alloc(4), dataLength = Buffer.alloc(8);
    nameLength.writeUInt32LE(name.length);
    dataLength.writeBigUInt64LE(size);
    return Buffer.concat([nameLength, Buffer.from(name), dataLength, bytes]);
  };
  const archive = Buffer.concat([Buffer.from('WBA1\x01\x02\0\0\0'),
    entry('node.db', Buffer.from('private box data')),
    entry('db.dump', database, oversized ? 5n * 1024n ** 3n : undefined)]);
  const cipher = createCipheriv('aes-256-gcm', key, frame.subarray(21));
  cipher.setAAD(frame);
  const encrypted = Buffer.concat([cipher.update(gzip ? gzipSync(archive) : archive), cipher.final()]);
  return Buffer.concat([frame, cipher.getAuthTag(), encrypted]);
}

export function backupManifest(archive: Buffer) {
  return JSON.stringify({archiveManifestVersion: 1, capturedAt: '2026-01-01T12:00:00.000Z',
    archiveSha256: createHash('sha256').update(archive).digest('hex'), laterChanges: 'unknown'});
}
