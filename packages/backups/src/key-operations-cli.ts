import { Pool } from "pg";
import { EmailOutbox } from "@waitron-cloud/registration";
import { inspectManagedKeyDependencies } from "./key-operations.ts";
import { BackupKeyVault } from "./keys.ts";

let pool: Pool | undefined;
try {
  if (process.argv.length !== 2 || !process.env.DATABASE_URL) throw new Error();
  const master = process.env.CLOUD_BACKUP_MASTER_KEY ?? "";
  const backupVault = /^[a-fA-F0-9]{64}$/.test(master)
    ? new BackupKeyVault(Buffer.from(master, "hex"))
    : undefined;
  let emailOutbox: EmailOutbox | undefined;
  let configuredEmailKeyIds: string[] = [];
  const activeEmailKeyId = process.env.CLOUD_EMAIL_ACTIVE_KEY_ID;
  try {
    const keys = JSON.parse(process.env.CLOUD_EMAIL_KEYS ?? "") as Record<string, string>;
    emailOutbox = new EmailOutbox({ activeKeyId: activeEmailKeyId ?? "", keys });
    configuredEmailKeyIds = Object.keys(keys);
  } catch {}

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  const report = await inspectManagedKeyDependencies(pool, {
    backupVault,
    emailOutbox,
    activeEmailKeyId,
    configuredEmailKeyIds,
  });
  console.log(JSON.stringify(report));
  if (!report.ready) process.exitCode = 2;
} catch {
  // Database and configuration errors may contain credentials; keep operator output fixed.
  console.error("Managed key check failed; check database and key configuration");
  process.exitCode = 1;
} finally {
  try {
    await pool?.end();
  } catch {
    process.exitCode = 1;
  }
}
