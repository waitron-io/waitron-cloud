import {createPrivateKey, randomUUID, X509Certificate} from 'node:crypto';
import {constants} from 'node:fs';
import {access, open, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createSecureContext, type SecureContext} from 'node:tls';
import {isHostname} from './manifest.ts';

const maxBytes = 16_384;
const identifierOid = Buffer.from('2b0601050507011f', 'hex');


export interface ChallengeFile {
  hostname: string;
  certificate: string;
  key: string;
  expiresAt: number;
}

interface LoadedChallenge {
  text: string;
  expiresAt: number;
  context: SecureContext;
}

function* derFields(bytes: Buffer) {
  let offset = 0;
  while (offset < bytes.length) {
    const tag = bytes[offset++]!;
    let length = bytes[offset++] ?? -1;
    if (length > 127) {
      const count = length & 127;
      if (count < 1 || count > 2 || offset + count > bytes.length) throw new Error('invalid_der');
      length = bytes.readUIntBE(offset, count);
      offset += count;
    }
    if (length < 0 || offset + length > bytes.length) throw new Error('invalid_der');
    const end = offset + length;
    yield {tag, value: bytes.subarray(offset, end)};
    offset = end;
  }
}

// RFC 8737 places the critical identifier in TBSCertificate.extensions ([3]).
function hasAcmeIdentifier(raw: Buffer) {
  const [certificate] = derFields(raw);
  if (certificate?.tag !== 0x30) return false;
  const [tbs] = derFields(certificate.value);
  if (tbs?.tag !== 0x30) return false;
  const wrapper = [...derFields(tbs.value)].find(field => field.tag === 0xa3);
  if (!wrapper) return false;
  const [extensions] = derFields(wrapper.value);
  if (extensions?.tag !== 0x30) return false;
  return [...derFields(extensions.value)].some(extension => {
    if (extension.tag !== 0x30) return false;
    const [oid, critical, data, extra] = derFields(extension.value);
    return oid?.tag === 6 && oid.value.equals(identifierOid)
      && critical?.tag === 1 && critical.value.length === 1 && critical.value[0] === 0xff
      && data?.tag === 4 && data.value.length === 34 && data.value[0] === 4 && data.value[1] === 32
      && !extra;
  });
}

function loadChallenge(text: string, hostname: string, now: number): LoadedChallenge | undefined {
  try {
    const fields = JSON.parse(text);
    if (!fields || Object.keys(fields).length !== 4 || fields.hostname !== hostname
      || typeof fields.certificate !== 'string' || typeof fields.key !== 'string'
      || !Number.isSafeInteger(fields.expiresAt) || fields.expiresAt <= now) return;
    const certificate = new X509Certificate(fields.certificate);
    if (certificate.subjectAltName !== 'DNS:' + hostname
      || !certificate.checkPrivateKey(createPrivateKey(fields.key)) || !hasAcmeIdentifier(certificate.raw)) return;
    return {text, expiresAt: fields.expiresAt, context: createSecureContext({cert: fields.certificate, key: fields.key})};
  } catch {
    return;
  }
}

async function readRegularFile(path: string) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maxBytes) return;
      const buffer = Buffer.alloc(maxBytes + 1);
      const {bytesRead} = await file.read(buffer);
      if (bytesRead === stat.size) return buffer.toString('utf8', 0, bytesRead);
    } finally {
      await file.close();
    }
  } catch {
    return;
  }
}

export async function readChallengeFolder(folder: string, names: ReadonlySet<string>, now: number,
  previous: ReadonlyMap<string, LoadedChallenge> = new Map()): Promise<Map<string, LoadedChallenge>> {
  const result = new Map<string, LoadedChallenge>();
  try {
    // A trailing slash requires the configured path to be a directory.
    await access(folder + '/', constants.X_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw error;
  }
  await Promise.all([...names].slice(0, 128).filter(isHostname).map(async hostname => {
    const text = await readRegularFile(join(folder, hostname + '.json'));
    if (text === undefined) return;
    const cached = previous.get(hostname);
    const loaded = cached?.text === text ? cached : loadChallenge(text, hostname, now);
    if (loaded && loaded.expiresAt > now) result.set(hostname, loaded);
  }));
  return result;
}

export async function deleteChallenge(folder: string, hostname: string): Promise<void> {
  if (!isHostname(hostname) || hostname.length > 237) throw new Error('invalid_hostname');
  await rm(join(folder, hostname + '.json'), {force: true});
}

export async function writeChallenge(folder: string, file: ChallengeFile, now = Date.now()): Promise<void> {
  if (!isHostname(file.hostname) || file.hostname.length > 237
    || !Number.isSafeInteger(file.expiresAt) || file.expiresAt <= now) throw new Error('invalid_challenge');
  for (const name of await readdir(folder)) {
    if (!name.endsWith('.json')) continue;
    const hostname = name.slice(0, -5);
    if (!isHostname(hostname) || hostname.length > 237) continue;
    const text = await readRegularFile(join(folder, name));
    if (text === undefined) continue;
    let expired = false;
    try {
      const fields = JSON.parse(text);
      expired = fields?.hostname === hostname && Number.isSafeInteger(fields.expiresAt) && fields.expiresAt <= now;
    } catch {}
    if (expired) await deleteChallenge(folder, hostname);
  }
  // The temporary basename must also fit when the hostname is 237 characters.
  const temporary = join(folder, '.' + randomUUID() + '.tmp');
  const {hostname, certificate, key, expiresAt} = file;
  try {
    await writeFile(temporary, JSON.stringify({hostname, certificate, key, expiresAt}), {flag: 'wx', mode: 0o600});
    await rename(temporary, join(folder, hostname + '.json'));
  } finally {
    await rm(temporary, {force: true});
  }
}
