import { Agent } from "node:https";
import { createHash, createPublicKey, sign, type KeyObject } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from "@aws-sdk/client-sts";
export interface StorageLocation {
  endpoint: string;
  bucket: string;
  region: string;
}
export interface StorageScope {
  kind: "capture" | "stream" | "restore";
  bucket: string;
  scope: string;
}
export interface StorageCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}
export function validateLocation(location: StorageLocation): void {
  try {
    const u = new URL(location.endpoint);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      !bucket(location.bucket) ||
      !location.region
    )
      throw new Error();
  } catch {
    throw new Error("backup.storage_configuration");
  }
}
function bucket(value: string) {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value);
}
function scopeValid(value: StorageScope) {
  const patterns = {
    capture: /^incoming\/[a-zA-Z0-9-]{1,80}$/,
    stream: /^streams\/[a-zA-Z0-9-]{1,80}\/$/,
    restore: /^snapshots\/[a-zA-Z0-9-]{1,80}$/,
  };
  return (
    bucket(value.bucket) &&
    Object.hasOwn(patterns, value.kind) &&
    patterns[value.kind].test(value.scope)
  );
}
interface AuthorityOptions {
  issuer: string;
  audience: string;
  keyId: string;
  privateKey: KeyObject;
  roles: Record<StorageScope["kind"], string>;
}
/** Only trusted Cloud code selects scopes. Provider policy independently applies the signed claims. */
export class StorageAuthority {
  readonly #options: AuthorityOptions;
  constructor(options: AuthorityOptions) {
    this.#options = options;
  }
  token(scope: StorageScope, now = Date.now()): string {
    if (!scopeValid(scope)) throw new Error("backup.storage_scope");
    const { issuer, audience, keyId, privateKey } = this.#options,
      enc = (v: unknown) =>
        Buffer.from(JSON.stringify(v)).toString("base64url");
    const input =
      enc({ alg: "RS256", kid: keyId, typ: "JWT" }) +
      "." +
      enc({
        iss: issuer,
        aud: audience,
        sub: `${scope.kind}:${scope.bucket}:${scope.scope}`,
        iat: Math.floor(now / 1000),
        exp: Math.floor(now / 1000) + 60,
        ...scope,
      });
    return (
      input +
      "." +
      sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")
    );
  }
  jwks() {
    const { privateKey, keyId } = this.#options;
    return {
      keys: [
        {
          ...createPublicKey(privateKey).export({ format: "jwk" }),
          kid: keyId,
          alg: "RS256",
          use: "sig",
        },
      ],
    };
  }
  async grant(location: StorageLocation, scope: StorageScope, ca?: string) {
    validateLocation(location);
    if (scope.bucket !== location.bucket)
      throw new Error("backup.storage_scope");
    const client = new STSClient({
      endpoint: location.endpoint,
      region: location.region,
      maxAttempts: 1,
      requestHandler: { httpsAgent: new Agent({ ca }) },
    });
    try {
      const result = await client.send(
        new AssumeRoleWithWebIdentityCommand({
          RoleArn: this.#options.roles[scope.kind],
          RoleSessionName: "waitron-backup",
          WebIdentityToken: this.token(scope),
          DurationSeconds: 900,
        }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
      const c = result.Credentials;
      if (
        !c?.AccessKeyId ||
        !c.SecretAccessKey ||
        !c.SessionToken ||
        !c.Expiration ||
        c.Expiration.getTime() <= Date.now() ||
        c.Expiration.getTime() > Date.now() + 901000
      )
        throw new Error("backup.storage_grant");
      return {
        credentials: {
          accessKeyId: c.AccessKeyId,
          secretAccessKey: c.SecretAccessKey,
          sessionToken: c.SessionToken,
        },
        expiresAt: c.Expiration.toISOString(),
      };
    } finally {
      client.destroy();
    }
  }
}
export interface ObjectReceipt {
  digest: string;
  size: number;
}
export function receipt(bytes: Uint8Array): ObjectReceipt {
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}
/** Local integration limits object memory to 512 MiB; larger backups need a streaming adapter. */
export class BackupObjects {
  readonly #client: S3Client;
  readonly location: StorageLocation;
  constructor(
    location: StorageLocation,
    credentials: StorageCredentials,
    ca?: string,
  ) {
    validateLocation(location);
    this.location = location;
    const options: S3ClientConfig = {
      endpoint: location.endpoint,
      region: location.region,
      credentials,
      forcePathStyle: true,
      maxAttempts: 2,
      requestHandler: { httpsAgent: new Agent({ ca }) },
    };
    this.#client = new S3Client(options);
  }
  async read(key: string, streamKey?: string): Promise<Buffer> {
    const result = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.location.bucket,
        Key: key,
        ...encryption(streamKey),
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    if (
      !result.Body ||
      !result.ContentLength ||
      result.ContentLength > 512 * 1024 * 1024
    )
      throw new Error("backup.object_invalid");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > 512 * 1024 * 1024) throw new Error("backup.object_invalid");
      chunks.push(Buffer.from(chunk));
    }
    if (size !== result.ContentLength) throw new Error("backup.object_invalid");
    return Buffer.concat(chunks);
  }
  async put(
    key: string,
    bytes: Uint8Array,
    streamKey?: string,
  ): Promise<ObjectReceipt> {
    if (bytes.length === 0 || bytes.length > 512 * 1024 * 1024)
      throw new Error("backup.object_invalid");
    const expected = receipt(bytes);
    try {
      const result = await this.#client.send(
        new PutObjectCommand({
          Bucket: this.location.bucket,
          Key: key,
          Body: bytes,
          IfNoneMatch: "*",
          ...encryption(streamKey),
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      if (streamKey && result.SSECustomerAlgorithm !== "AES256")
        throw new Error("backup.encryption_unconfirmed");
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "$metadata" in error &&
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412
      ))
        throw error;
      const prior = receipt(await this.read(key, streamKey));
      if (prior.digest !== expected.digest || prior.size !== expected.size)
        throw new Error("backup.object_conflict");
    }
    return expected;
  }
  async remove(key: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.location.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
  }
  close() {
    this.#client.destroy();
  }
}
function encryption(key?: string) {
  if (key === undefined) return {};
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key))
    throw new Error("backup.key_unavailable");
  return {
    SSECustomerAlgorithm: "AES256",
    SSECustomerKey: key,
    SSECustomerKeyMD5: createHash("md5")
      .update(Buffer.from(key, "base64"))
      .digest("base64"),
  };
}
