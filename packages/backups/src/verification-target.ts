import {
  parseBackupVerificationJson,
  validateBackupVerificationTarget,
  type BackupVerificationTarget,
} from "./verification-protocol.ts";

export const BACKUP_VERIFICATION_REVISION =
  "741c77a05806bf11367e93ef165c57e4de92eda3";
export const BACKUP_VERIFICATION_TARGET_DIGEST =
  "47641bc8edc4909fe7dcf427c36675a3656878bc3c0ff759b8c3222dadc549fe";

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
