import {
  parseBackupVerificationJson,
  validateBackupVerificationTarget,
  type BackupVerificationTarget,
} from "./verification-protocol.ts";

export const BACKUP_VERIFICATION_REVISION =
  "5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa";
export const BACKUP_VERIFICATION_TARGET_DIGEST =
  "27b6669fe7367c9619bd71fb7ac6ce0edcd97d5a7f3c6e83d953468ed62932c5";

export function readVerificationTarget(raw: string): BackupVerificationTarget {
  try {
    const target = validateBackupVerificationTarget(
      parseBackupVerificationJson(raw, 30000),
    );
    // Recomputed hashes prove internal consistency; the pin binds the installed release.
    if (
      target.runtime.revision !== BACKUP_VERIFICATION_REVISION ||
      target.runtime.release !== `waitron-${BACKUP_VERIFICATION_REVISION}` ||
      target.digest !== BACKUP_VERIFICATION_TARGET_DIGEST
    )
      throw new Error();
    return target;
  } catch {
    throw new Error("Invalid backup verification target");
  }
}
