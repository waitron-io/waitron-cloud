import { Pool } from "pg";
import { inspectManagedKeyDependencies } from "./key-operations.ts";
import { BackupKeyVault } from "./keys.ts";

let pool: Pool | undefined;
try {
  if (process.argv.length !== 2 || !process.env.DATABASE_URL) throw new Error();
  const master = process.env.CLOUD_BACKUP_MASTER_KEY ?? "";
  const backupVault = /^[a-fA-F0-9]{64}$/.test(master)
    ? new BackupKeyVault(Buffer.from(master, "hex"))
    : undefined;
  const activeEmailKeyId = process.env.CLOUD_EMAIL_ACTIVE_KEY_ID;
  if (!activeEmailKeyId || !process.env.CLOUD_EMAIL_KEYS) throw new Error();
  const emailKeys = {
    activeKeyId: activeEmailKeyId,
    keys: JSON.parse(process.env.CLOUD_EMAIL_KEYS) as Record<string, string>,
  };

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  const report = await inspectManagedKeyDependencies(pool, {
    backupVault,
    emailKeys,
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
