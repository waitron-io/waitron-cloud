import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export interface BackupKeys {
  recoveryKey: string;
  streamKey: string;
}
function context(venue: string, version: number): Buffer {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      venue,
    ) ||
    !Number.isSafeInteger(version) ||
    version < 1
  )
    throw new Error("backup.key_context");
  return Buffer.from(
    JSON.stringify(["waitron-cloud-backup-key", venue, version]),
  );
}
/** The master key stays outside PostgreSQL; changing the row's venue or version invalidates it. */
export class BackupKeyVault {
  readonly #key: Buffer;
  constructor(master: Uint8Array) {
    if (master.length !== 32) throw new Error("backup.key_configuration");
    this.#key = Buffer.from(master);
  }
  create(venue: string, version: number): string {
    const aad = context(venue, version),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(aad);
    const keys: BackupKeys = {
      recoveryKey: randomBytes(32).toString("base64url"),
      streamKey: randomBytes(32).toString("base64"),
    };
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(keys)),
      cipher.final(),
    ]);
    return (
      "v1." +
      Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")
    );
  }
  open(venue: string, version: number, sealed: string): BackupKeys {
    try {
      const aad = context(venue, version);
      if (!/^v1\.[A-Za-z0-9_-]{50,2048}$/.test(sealed)) throw new Error();
      const bytes = Buffer.from(sealed.slice(3), "base64url");
      if (bytes.toString("base64url") !== sealed.slice(3)) throw new Error();
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(12, 28));
      const keys = JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      ) as BackupKeys;
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(keys.recoveryKey) ||
        !/^[A-Za-z0-9+/]{43}=$/.test(keys.streamKey)
      )
        throw new Error();
      return keys;
    } catch {
      throw new Error("backup.key_unavailable");
    }
  }
}
