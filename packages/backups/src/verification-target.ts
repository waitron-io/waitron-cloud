import {
  parseBackupVerificationJson,
  validateBackupVerificationTarget,
  type BackupVerificationTarget,
} from "./verification-protocol.ts";

export const BACKUP_VERIFICATION_REVISION =
  "ec91a9e34d2daba146f4ee61850ea4136ad5cfb7";
export const BACKUP_VERIFICATION_TARGET_DIGEST =
  "2e9a53ebe041b37415b0983563edaa1529714b42f3cd2637987b976667164d10";

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
