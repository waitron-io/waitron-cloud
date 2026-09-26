import { Agent } from "node:https";
import { createHash, createPublicKey, sign, type KeyObject } from "node:crypto";
import { Readable } from "node:stream";
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
import {
  MAX_OBJECT_BYTES,
  bufferObject,
  stageReadable,
  type ObjectReceipt,
  type ReplayableObject,
  type StageOptions,
} from "./object-transfer.ts";
export { receipt, type ObjectReceipt } from "./object-transfer.ts";
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
      maxAttempts: 1,
      logger: streamingLogger,
      requestHandler: { httpsAgent: new Agent({ ca }) },
    };
    this.#client = new S3Client(options);
  }
  async stage(
    key: string,
    streamKey?: string,
    options: StageOptions = {},
  ): Promise<ReplayableObject> {
    const operationSignal = abortSignal(options);
    return this.#stage(key, streamKey, options, operationSignal);
  }
  async #stage(
    key: string,
    streamKey: string | undefined,
    options: StageOptions,
    operationSignal: AbortSignal,
  ): Promise<ReplayableObject> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.#client.send(
          new GetObjectCommand({
            Bucket: this.location.bucket,
            Key: key,
            ...encryption(streamKey),
          }),
          { abortSignal: operationSignal },
        );
        if (!result.Body) throw new Error("backup.object_invalid");
        return await stageReadable(
          Readable.from(result.Body as AsyncIterable<Uint8Array>),
          result.ContentLength as number,
          { ...options, signal: operationSignal },
        );
      } catch (error) {
        if (operationSignal.aborted) throw new Error("backup.cancelled");
        if (attempt === 0 && transient(error)) continue;
        throw error;
      }
    }
    throw new Error("backup.object_invalid");
  }
  async read(key: string, streamKey?: string): Promise<Buffer> {
    const staged = await this.stage(key, streamKey);
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of staged.open()) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks, staged.receipt.size);
    } finally {
      await staged.dispose();
    }
  }
  async put(
    key: string,
    bytes: Uint8Array,
    streamKey?: string,
  ): Promise<ObjectReceipt> {
    return this.putStaged(key, bufferObject(bytes), streamKey);
  }
  async putStaged(
    key: string,
    source: ReplayableObject,
    streamKey?: string,
    options: StageOptions = {},
  ): Promise<ObjectReceipt> {
    const expected = source.receipt;
    if (
      !Number.isSafeInteger(expected.size) ||
      expected.size < 1 ||
      expected.size > MAX_OBJECT_BYTES ||
      !/^[0-9a-f]{64}$/.test(expected.digest)
    )
      throw new Error("backup.object_invalid");
    const operationSignal = abortSignal(options);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.#client.send(
          new PutObjectCommand({
            Bucket: this.location.bucket,
            Key: key,
            Body: source.open(),
            ContentLength: expected.size,
            IfNoneMatch: "*",
            ...encryption(streamKey),
          }),
          { abortSignal: operationSignal },
        );
        if (streamKey && result.SSECustomerAlgorithm !== "AES256")
          throw new Error("backup.encryption_unconfirmed");
        return expected;
      } catch (error) {
        if (operationSignal.aborted) throw new Error("backup.cancelled");
        if (status(error) === 412) {
          const prior = await this.#stage(
            key,
            streamKey,
            options,
            operationSignal,
          );
          try {
            if (
              prior.receipt.digest !== expected.digest ||
              prior.receipt.size !== expected.size
            )
              throw new Error("backup.object_conflict");
            return expected;
          } finally {
            await prior.dispose();
          }
        }
        if (attempt === 0 && transient(error)) continue;
        throw error;
      }
    }
    throw new Error("backup.object_invalid");
  }
  async remove(key: string): Promise<void> {
    const operationSignal = AbortSignal.timeout(10000);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.#client.send(
          new DeleteObjectCommand({ Bucket: this.location.bucket, Key: key }),
          { abortSignal: operationSignal },
        );
        return;
      } catch (error) {
        if (attempt === 0 && transient(error)) continue;
        throw error;
      }
    }
  }
  close() {
    this.#client.destroy();
  }
}
function status(error: unknown) {
  return error && typeof error === "object" && "$metadata" in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined;
}
function transient(error: unknown) {
  const code = status(error);
  return (
    code === 408 ||
    code === 429 ||
    (code !== undefined && code >= 500) ||
    (error !== null &&
      typeof error === "object" &&
      "$retryable" in error &&
      Boolean(error.$retryable)) ||
    (error instanceof Error &&
      ["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(
        (error as Error & { code?: string }).code ?? "",
      ))
  );
}
function abortSignal(options: StageOptions) {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 30000);
  return options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
}
const streamingLogger = {
  debug() {},
  info() {},
  warn(...values: unknown[]) {
    if (values[0] !== "An error was encountered in a non-retryable streaming request.")
      console.warn(...values);
  },
  error() {},
};
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
