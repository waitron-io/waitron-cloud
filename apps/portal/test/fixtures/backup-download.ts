import {createCipheriv, createDecipheriv, createHash, hkdfSync, scryptSync} from 'node:crypto';
import {gzipSync} from 'node:zlib';

export const recoveryKey = 'k'.repeat(43);
export const venueDatabase = Buffer.from('SQLite format 3\0synthetic venue rows');
const frame = Buffer.concat([Buffer.from('WBK1\x01'), Buffer.alloc(16, 42), Buffer.alloc(12, 24)]);
const key = scryptSync(recoveryKey, frame.subarray(5, 21), 32, {N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 ** 2});

export const numberedBackupKey = Buffer.alloc(32, 7);
export const numberedKeyRecord = `WAITRON_BACKUP_RECOVERY_KEY=${numberedBackupKey.toString('base64url')}\n` +
  'WAITRON_BACKUP_KEY_NUMBER=7\nWAITRON_BACKUP_MASTER_KEY_ID=0011223344556677\nWAITRON_BACKUP_MASTER_KEY_DAY=2026-11-23\n';

export function backupPayload({gzip = false, database = venueDatabase, databaseLength, keyRecords = []}:
    {gzip?:boolean; database?:Buffer; databaseLength?:number; keyRecords?:string[]} = {}) {
  const entry = (name: string, bytes: Buffer, length = bytes.length) => {
    const nameLength = Buffer.alloc(4), dataLength = Buffer.alloc(8);
    nameLength.writeUInt32LE(name.length);
    dataLength.writeBigUInt64LE(BigInt(length));
    return Buffer.concat([nameLength, Buffer.from(name), dataLength, bytes]);
  };
  const archive = Buffer.concat([Buffer.from([87, 66, 65, 49, 1, 2 + keyRecords.length, 0, 0, 0]),
    entry('node.db', Buffer.from('private box data')),
    entry('db.dump', database, databaseLength),
    ...keyRecords.map(record => entry('secrets/backup.env', Buffer.from(record)))]);
  return gzip ? gzipSync(archive) : archive;
}

export function backupBytes(options?: Parameters<typeof backupPayload>[0]) {
  const cipher = createCipheriv('aes-256-gcm', key, frame.subarray(21));
  cipher.setAAD(frame);
  const encrypted = Buffer.concat([cipher.update(backupPayload(options)), cipher.final()]);
  return Buffer.concat([frame, cipher.getAuthTag(), encrypted]);
}

export function openBackupExport(bytes: Buffer) {
  const key = Buffer.from(hkdfSync('sha256', numberedBackupKey, bytes.subarray(27,43), 'waitron.archive.v2',32));
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(43,55));
  decipher.setAAD(bytes.subarray(0,55));
  decipher.setAuthTag(bytes.subarray(55,71));
  return Buffer.concat([decipher.update(bytes.subarray(71)), decipher.final()]);
}

export function backupManifest(archive: Buffer) {
  return JSON.stringify({archiveManifestVersion: 1, capturedAt: '2026-01-01T12:00:00.000Z',
    archiveSha256: createHash('sha256').update(archive).digest('hex'), laterChanges: 'unknown'});
}
