import {
  parseBackupVerificationJson,
  validateBackupVerificationTarget,
  type BackupVerificationTarget,
} from "./verification-protocol.ts";

export const BACKUP_VERIFICATION_REVISION =
  "8eed667ab0586a3144ed7911b57cf50fcb3b0766";
export const BACKUP_VERIFICATION_TARGET_DIGEST =
  "05d5b2665dc9d76426615dd347815f48e0bab7a3dbd208083e2dba3c6b0e0ec0";

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
