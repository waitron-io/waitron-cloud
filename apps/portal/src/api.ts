import {validPasswordLogin,validFactorStatus,validFactorEnrolment,validFactorChange} from './authenticator-types.ts';
import {validRecoveryView} from './recovery-types.ts';
import {validRemoteView,validRemoteDns} from './remote-types.ts';
import {validBackupPage} from './backup-types.ts';
import {validInstallation} from './installation-types.ts';
import { validBusinesses, validPairingView } from './pairing-types.ts';
import {validAuthenticationOptions, validPasskeyList, validPasskeySummary, validRegistrationOptions} from './passkey-types.ts';
import {validAccountSessions} from './account-security-types.ts';
import {validUsageSummary} from './usage-types.ts';
import {validDiagnosticExport} from './diagnostic-types.ts';
export type ApiResult<T> = {ok: true; value: T} | {ok: false; status: number; code: string; retryAfterMs: number};
function validResult(path: string, value: unknown, status: number): boolean {
  if(path==='/login')return validPasswordLogin(value,status);
  if(path==='/login/factor')return validPasswordLogin(value,status)&&status===200;
  if(path==='/authenticator')return status===200&&validFactorStatus(value);
  if(path==='/authenticator/begin')return status===200&&validFactorEnrolment(value);
  if(path==='/authenticator/activate'||path==='/authenticator/regenerate')return status===200&&validFactorChange(value,true);
  if(path==='/authenticator/remove')return status===200&&validFactorChange(value,false);
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if(path==='/sessions')return validAccountSessions(value);
  if(path==='/passkeys')return validPasskeyList(value);
  if(path==='/passkeys/authentication/options')return validAuthenticationOptions(value);
  if(path==='/passkeys/registration/options')return validRegistrationOptions(value);
  if(path==='/passkeys/registration/verify')return validPasskeySummary(value);
  if(path==='/passkeys/authentication/verify')return typeof data.accountId==='string'&&data.accountId.length>0;
  if(path.startsWith('/recovery/'))return validRecoveryView(value);
  if(path==='/remote-access/status'||path==='/remote-access/apply')return validRemoteView(value);
  if(path==='/remote-access/dns')return validRemoteDns(value);
  if(path==='/translation-consent')return status===200&&validTranslationConsents(value);
  if(path==='/alerts')return typeof data.enabled==='boolean'&&typeof data.locale==='string'&&['en','es'].includes(data.locale);
  if(path==='/usage/read')return validUsageSummary(value);
  if(path==='/diagnostics/read')return validDiagnosticExport(value);
  if(path==='/backups/list')return validBackupPage(value);
  if (path === '/pairing/businesses') return validBusinesses(data.businesses);
  if (path === '/pairing/inspect' || path === '/pairing/approve') return validPairingView(data);
  if(path==='/installations') return Array.isArray(data.installations)&&data.installations.every(v=>validInstallation(v)&&typeof v.canRevoke==='boolean');
  if(path==='/installations/revoke') return validInstallation(data);
  const account = typeof data.accountId === 'string' && data.accountId.length > 0;
  if (path === '/session' || path === '/session/activity') return account && typeof data.expiresAt === 'string' && Number.isFinite(Date.parse(data.expiresAt));
  if (path === '/signup/complete') return account && typeof data.organisationId === 'string' && typeof data.legalBusinessId === 'string';
  if (path.endsWith('/request')) return data.status === 'accepted';
  return path === '/password-reset/complete' && data.status === 'completed';
}
export async function accountRequest<T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (path.startsWith('/recovery/') || path.startsWith('/remote-access/') || path === '/usage/read' || path === '/diagnostics/read' || (path === '/alerts' && body) || (path === '/translation-consent' && body) || path === '/backups/list' || path === '/session/activity' || path === '/logout' || path === '/sessions/revoke' || path === '/installations/revoke' || (path.startsWith('/pairing/') && body) || path.startsWith('/passkeys/registration/') || path === '/passkeys/remove' || (path.startsWith('/authenticator/') && body)) {
    const name = location.protocol === 'https:' ? '__Host-cloud_csrf' : 'cloud_csrf';
    const values = document.cookie.split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
    headers['X-CSRF-Token'] = values.length === 1 ? values[0]!.slice(name.length + 1) : '';
  }
  try {
    const response = await fetch(`/api/account${path}`, {method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(15_000)});
    const elapsedRetry = path === '/usage/read' || path === '/alerts' || path === '/backups/list' || path.startsWith('/pairing/'), receivedAt = elapsedRetry ? performance.now() : 0;
    const retry = response.headers.get('retry-after') ?? '';
    const serverDate = elapsedRetry ? Date.parse(response.headers.get('date') ?? '') : NaN;
    const retryAfterMs = Math.max(0, /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - (Number.isFinite(serverDate) ? serverDate : Date.now())) || 0;
    if (response.ok && (path === '/logout' || path === '/sessions/revoke' || path === '/passkeys/remove' || path === '/authenticator/cancel') && response.status === 204) return {ok: true, value: undefined as T};
    const value: unknown = await response.json().catch(() => null);
    if (response.ok && validResult(path, value, response.status)) return {ok: true, value: value as T};
    const codes = ['dns_not_verified','hostname_conflict','revision_conflict','remote_not_placed','invalid_hostname','pairing_unavailable', 'permission_denied', 'binding_conflict', 'invalid_input', 'credentials_invalid', 'unauthenticated', 'session_expired', 'forbidden', 'link_unavailable', 'password_compromised', 'rate_limited', 'temporarily_unavailable'];
    if(response.status===403&&['/remote-access/status','/remote-access/dns','/remote-access/apply'].includes(path))codes.push('remote_plan_required','remote_setup_required','remote_test_only','revoked');
    if(path.startsWith('/recovery/')){
      if(response.status===400)codes.push('confirmation_required','unverified');
      if(response.status===409)codes.push('approval_required','conflict','target_not_fresh','recovery_active');
      if(response.status===403)codes.push('local_integration_only');
    }
    const code = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' && codes.includes(value.error)
      ? value.error : 'unexpected_response';
    return {ok: false, status: response.ok ? 503 : response.status, code, retryAfterMs: elapsedRetry ? Math.max(0, retryAfterMs - (performance.now() - receivedAt)) : retryAfterMs};
  } catch { return {ok: false, status: 0, code: 'network_error', retryAfterMs: 0}; }
}

function validTranslationConsents(value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const consents=(value as Record<string,unknown>).consents;
 if(!Array.isArray(consents))return false;
 const seen=new Set<string>();
 return consents.every(choice=>{
  if(!choice||typeof choice!=='object'||Array.isArray(choice))return false;
  const c=choice as Record<string,unknown>;
  if(typeof c.venueId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.venueId)||seen.has(c.venueId))return false;
  seen.add(c.venueId);
  return typeof c.consented==='boolean'&&(c.consented?typeof c.consentedAt==='string'&&Number.isFinite(Date.parse(c.consentedAt)):c.consentedAt===null);
 });
}
