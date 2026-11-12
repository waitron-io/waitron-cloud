import {
  parseBackupVerificationJson,
  validateBackupVerificationTarget,
  type BackupVerificationTarget,
} from "./verification-protocol.ts";

export const BACKUP_VERIFICATION_REVISION =
  "515c12dc1644b6516fe6e45a7243a448acd51b0c";
export const BACKUP_VERIFICATION_TARGET_DIGEST =
  "f05bfa87cb6153f76945bfd8d7b9ca62943e08e2991505360463b3994bbcab77";

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
