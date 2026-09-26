export { hashSecret, verifySecret } from './secret-hash.ts';
export { createSession, IdentityError, IDLE_TIMEOUT_MS, listAccountSessions, login, requireCurrentPassword,
  resolveSession, endSession, requirePlatformPermission, revokeAccountSession, withPassiveRead } from './sessions.ts';
export type { AccountSessionRevocation, AccountSessionSummary, Session, SessionCredentials } from './sessions.ts';
