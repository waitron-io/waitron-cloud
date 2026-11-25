import {validAccountBusinesses} from './account-businesses-controller.ts';
import {validOwnerRecoveryResult} from './owner-recovery-controller.ts';
import {validOwnerTransfer,validOwnerTransferList} from './owner-transfer-types.ts';
import {translations} from './locale.ts';
import {validPasswordLogin,validFactorStatus,validFactorEnrolment,validFactorChange} from './authenticator-types.ts';
import {validRecoveryDate,validRecoveryView} from './recovery-types.ts';
import {validRemoteView,validRemoteDns,validGuestMenuView} from './remote-types.ts';
import {validBackupPage} from './backup-types.ts';
import {validSentReportDetail, validSentReportsPage} from './sent-reports-types.ts';
import {validInstallation} from './installation-types.ts';
import { validBusinesses, validPairingView } from './pairing-types.ts';
import {validAuthenticationOptions, validPasskeyList, validPasskeySummary, validRegistrationOptions} from './passkey-types.ts';
import {validAccountSessions} from './account-security-types.ts';
import {validUsageSummary} from './usage-types.ts';
import {validDiagnosticExport} from './diagnostic-types.ts';
import {validBillingView,validMethodPresentation,validMethodResult} from './billing-types.ts';
export const enrollmentRequiredEvent = 'cloud-enrollment-required';
export type ApiResult<T> = {ok: true; value: T} | {ok: false; status: number; code: string; retryAfterMs: number; recoveryExpiresAt?: string};
export type OperatorVenue={id:string;name:string|null;stopped:boolean};
export type OperatorVenueSearch={venues:OperatorVenue[];tooMany?:true};
function validOperatorVenue(value:unknown):value is OperatorVenue{
  if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='id,name,stopped')return false;
  const {id,name,stopped}=value as OperatorVenue;
  return typeof id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)
    &&(name===null||typeof name==='string')&&typeof stopped==='boolean';
}
function validResult(path: string, value: unknown, status: number): boolean {
  if(path.startsWith('/owner-recovery/'))return status===200&&validOwnerRecoveryResult(path,value);
  if (path === '/businesses' || path === '/organisations/rename') return status === 200 && validAccountBusinesses(value);
  if(path==='/owner-transfers')return status===200&&validOwnerTransferList(value);
  if(path==='/owner-transfers/create')return status===202&&!!value&&typeof value==='object'&&(value as {status?:unknown}).status==='accepted';
  if(path==='/owner-transfers/accept'||path==='/owner-transfers/cancel')return status===200&&validOwnerTransfer(value);
  if(path==='/operator/actions/requests'||path==='/operator/actions/decide')return [200,201].includes(status)&&validCloudActionRequest(value);
  if(path==='/operator/actions'){
    const view=value as {actions?:unknown;requests?:unknown;operatorVenues?:unknown}|null;
    const actions=view?.actions;
    return status===200&&(view?.operatorVenues===undefined||view.operatorVenues===true)&&Array.isArray(view?.requests)
      &&view.requests.every(validCloudActionRequest)&&Array.isArray(actions)&&actions.length>0&&actions.length<=16&&new Set(actions.map(a=>a?.id)).size===actions.length&&actions.every(a=>
      a&&typeof a.id==='string'&&Object.hasOwn(translations.en,`cloudAction_${a.id}`)&&['ask-first','act-and-report'].includes(a.policy)&&a.available===false);
  }
  if(path==='/operator/venues/read'){
    const search=value as Partial<OperatorVenueSearch>|null;
    return status===200&&Array.isArray(search?.venues)&&search.venues.length<=10&&search.venues.every(validOperatorVenue)
      &&(search.tooMany===undefined||search.tooMany===true&&search.venues.length===0);
  }
  if(path==='/operator/venues/address-lookup')return status===200&&validOperatorVenue(value);
  if(path==='/security/email')return status===202&&!!value&&typeof value==='object'&&(value as {status?:unknown}).status==='accepted';
  if(path==='/billing/method/start')return status===200&&validMethodPresentation(value);
  if(path==='/billing/method/verify')return status===200&&validMethodResult(value);
  if(path==='/billing/read'||path==='/billing/start-trial'||path==='/billing/tax/save')return status===200&&validBillingView(value);
  if(path==='/action-proof')return status===200&&!!value&&typeof value==='object'&&Array.isArray((value as any).methods)&&(value as any).methods.length>0&&(value as any).methods.every((m:unknown)=>['email','app','passkey','recovery'].includes(String(m)))&&((value as any).freshUntil===null||typeof (value as any).freshUntil==='string'&&Number.isFinite(Date.parse((value as any).freshUntil)));
  if(path==='/action-proof/email')return status===200&&!!value&&typeof value==='object'&&typeof (value as any).challengeToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test((value as any).challengeToken)&&typeof (value as any).expiresAt==='string'&&Number.isFinite(Date.parse((value as any).expiresAt));
  if(path==='/action-proof/passkey/options')return status===200&&validAuthenticationOptions(value);
  if(path==='/login')return validPasswordLogin(value,status);
  if((path==='/login/factor'||path==='/login/email'||path==='/login/recovery'))return validPasswordLogin(value,status)&&status===200;
  if(path==='/authenticator')return status===200&&validFactorStatus(value);
  if(path==='/authenticator/begin')return status===200&&validFactorEnrolment(value);
  if(path==='/authenticator/activate'||path==='/authenticator/regenerate')return status===200&&validFactorChange(value,path==='/authenticator/activate'?'activate':'regenerate');
  if(path==='/authenticator/remove')return status===200&&validFactorChange(value,'remove');
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if(path==='/sessions')return validAccountSessions(value);
  if(path==='/passkeys')return validPasskeyList(value);
  if(path==='/passkeys/authentication/options')return validAuthenticationOptions(value);
  if(path==='/passkeys/registration/options')return validRegistrationOptions(value);
  if(path==='/passkeys/registration/verify')return validPasskeySummary(value);
  if(path==='/passkeys/authentication/verify')return typeof data.accountId==='string'&&data.accountId.length>0;
  if(path.startsWith('/recovery/'))return validRecoveryView(value);
  if(path==='/remote-access/status'||path==='/remote-access/apply'||path==='/remote-access/recheck')return validRemoteView(value);
  if(path==='/remote-access/dns')return validRemoteDns(value);
  if(path==='/guest-menu/takedown'||path==='/guest-menu/enable')return status===200&&validGuestMenuView(value);
  if(path==='/translation-consent')return status===200&&validTranslationConsents(value);
  if(path==='/alerts')return typeof data.enabled==='boolean'&&typeof data.locale==='string'&&['en','es'].includes(data.locale);
  if(path==='/usage/read')return validUsageSummary(value);
  if(path==='/diagnostics/read')return validDiagnosticExport(value);
  if(path==='/backups/list')return validBackupPage(value);
  if(path==='/sent-reports/list')return status===200&&validSentReportsPage(value);
  if(path==='/sent-reports/read')return status===200&&validSentReportDetail(value);
  if (path === '/pairing/businesses') return validBusinesses(data.businesses);
  if (path === '/pairing/authorize' || path === '/pairing/cancel') return status === 200 && typeof data.returnUrl === 'string';
  if (path === '/pairing/inspect' || path === '/pairing/approve') return validPairingView(data);
  if(path==='/installations') return Array.isArray(data.installations)&&data.installations.every(v=>validInstallation(v)&&typeof v.canRevoke==='boolean');
  if(path==='/installations/remove') return status===200&&validInstallation(data)&&typeof data.portalRemovedAt==='string';
  const account = typeof data.accountId === 'string' && data.accountId.length > 0;
  if (path === '/session' || path === '/session/activity') return account && typeof data.expiresAt === 'string' && Number.isFinite(Date.parse(data.expiresAt)) && (data.billingTrialAvailable === undefined || data.billingTrialAvailable === true) && (data.enrollmentRequired === undefined || data.enrollmentRequired === true);
  if (path === '/signup/complete') return status === 201 && typeof data.accountId === 'string' && data.accountId.trim().length > 0;
  if (path === '/signup/request' || path === '/password-reset/request') return status === 202 && data.status === 'accepted';
  return path === '/password-reset/complete' && status === 200 && data.status === 'completed';
}
function browserCsrfToken() {
 const name=location.protocol==='https:'?'__Host-cloud_csrf':'cloud_csrf';
 const values=document.cookie.split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));
 return values.length===1?values[0]!.slice(name.length+1):'';
}
export async function accountRequest<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<ApiResult<T>> {
  const keyDownload = path === '/backups/download-key';
  const download = keyDownload || path === '/backups/download';
  const installationWrite = path === '/installations/remove';
  const sentReports = path === '/sent-reports/list' || path === '/sent-reports/read';
  const businessPath = path === '/businesses' || path === '/organisations/rename';
  const operatorVenue = path.startsWith('/operator/venues/');
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if ((businessPath && body) || path.startsWith('/owner-transfers/') || path.startsWith('/operator/actions/') || operatorVenue || path.startsWith('/security/') || path.startsWith('/action-proof/') || path.startsWith('/billing/') || path.startsWith('/recovery/') || path.startsWith('/remote-access/') || path.startsWith('/guest-menu/') || path === '/usage/read' || path === '/diagnostics/read' || (path === '/alerts' && body) || (path === '/translation-consent' && body) || path === '/backups/list' || download || sentReports || path === '/session/activity' || path === '/logout' || path === '/sessions/revoke' || installationWrite || (path.startsWith('/pairing/') && body) || path.startsWith('/passkeys/registration/') || path === '/passkeys/remove' || (path.startsWith('/authenticator/') && body)) {
    headers['X-CSRF-Token'] = browserCsrfToken();
  }
  try {
    const timeout = AbortSignal.timeout(download ? 30_000 : 15_000);
    const response = await fetch(`/api/account${path}`, {method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers, ...(body ? {body: JSON.stringify(body)} : {}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(download ? {mode: 'same-origin', redirect: 'error', cache: 'no-store'} : {})});
    if (download && response.ok) {
      if (response.status === 200 && response.headers.get('content-type') === (keyDownload ? 'text/plain; charset=utf-8' : 'application/octet-stream')) {
        const value = await response.blob();
        if (keyDownload ? value.size === 44 : value.size > 0 && value.size <= 16 * 1024 * 1024) return {ok: true, value: value as T};
      }
      return {ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0};
    }
    const elapsedRetry = businessPath || path.startsWith('/owner-recovery/') || path.startsWith('/owner-transfers') || path.startsWith('/operator/actions') || operatorVenue || path.startsWith('/security/') || path.startsWith('/action-proof') || path.startsWith('/billing/') || path === '/usage/read' || path === '/alerts' || path === '/backups/list' || download || sentReports || path.startsWith('/pairing/') || path === '/installations' || installationWrite || path === '/diagnostics/read' || path.startsWith('/remote-access/') || path.startsWith('/guest-menu/') || path.startsWith('/recovery/') || path === '/translation-consent' || path.startsWith('/passkeys') || path.startsWith('/authenticator') || ['/login', '/login/factor', '/login/email', '/login/recovery', '/sessions', '/sessions/revoke', '/session', '/session/activity', '/logout', '/signup/request', '/signup/complete', '/password-reset/request', '/password-reset/complete'].includes(path), receivedAt = elapsedRetry ? performance.now() : 0;
    const retry = response.headers.get('retry-after') ?? '';
    const serverDate = elapsedRetry ? Date.parse(response.headers.get('date') ?? '') : NaN;
    const retryAfterMs = Math.max(0, /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - (Number.isFinite(serverDate) ? serverDate : Date.now())) || 0;
    if (response.ok && (path==='/security/password'||path==='/security/email/verify'||path==='/action-proof/email/verify'||path==='/action-proof/factor'||path==='/action-proof/passkey/verify'||path === '/logout' || path === '/sessions/revoke' || path === '/passkeys/remove' || path === '/authenticator/cancel') && response.status === 204) return {ok: true, value: undefined as T};
    const value: unknown = await response.json().catch(() => null);
    if (response.ok && validResult(path, value, response.status)) return {ok: true, value: value as T};
    const codes = ['proof_required','enrollment_required','dns_not_verified','hostname_conflict','revision_conflict','remote_not_placed','invalid_hostname','pairing_unavailable', 'permission_denied', 'binding_conflict', 'invalid_input', 'credentials_invalid', 'unauthenticated', 'session_expired', 'forbidden', 'link_unavailable', 'password_compromised', 'rate_limited', 'temporarily_unavailable'];
    if ([400, 503].includes(response.status) && ['/signup/request', '/password-reset/request'].includes(path)) codes.push('browser_check_failed');
    if (response.status === 429 && ['/signup/request', '/signup/complete'].includes(path)) codes.push('signup_rate_limited');
    if (response.status === 429 && path === '/signup/complete') codes.push('signup_domain_limited');
    if(download&&response.status===413)codes.push('download_too_large');
    if(path==='/installations/remove'&&response.status===503)codes.push('guest_menu_takedown_failed');
    if(businessPath&&response.status===400)codes.push('country_unavailable');
    if(businessPath&&response.status===409)codes.push('business_match_ambiguous');
    if(path.startsWith('/owner-recovery/'))codes.push('recovery_scope_limited','recovery_unavailable','recovery_invalid','password_screening_unavailable');
    if(path.startsWith('/owner-transfers/'))codes.push('transfer_unavailable','transfer_pending','recovery_in_progress');
    if(path==='/security/password'&&response.status===503)codes.push('password_screening_unavailable');
    if(path.startsWith('/operator/actions/')&&response.status===409)codes.push('conflict');
    if(path.startsWith('/billing/')&&response.status===409)codes.push('conflict');
    if(response.status===400&&path.startsWith('/authenticator/'))codes.push('setup_unavailable','factor_not_active');
    if(response.status===403&&['/remote-access/status','/remote-access/dns','/remote-access/apply','/remote-access/recheck'].includes(path))codes.push('remote_plan_required','remote_setup_required','remote_test_only','revoked');
    if(path.startsWith('/recovery/')){
      if(response.status===400)codes.push('confirmation_required','unverified');
      if(response.status===409)codes.push('approval_required','conflict','target_not_fresh','recovery_active');
      if(response.status===403)codes.push('local_integration_only');
    }
    const code = !response.ok && value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' && codes.includes(value.error)
      ? value.error : 'unexpected_response';
    if (response.status === 403 && code === 'enrollment_required' && !['/session','/session/activity'].includes(path)) globalThis.document?.dispatchEvent?.(new Event(enrollmentRequiredEvent));
    const recoveryExpiresAt=(value as {recoveryExpiresAt?:unknown}|null)?.recoveryExpiresAt;
    return {ok: false, status: response.ok ? 503 : response.status, code, retryAfterMs: elapsedRetry ? Math.max(0, retryAfterMs - (performance.now() - receivedAt)) : retryAfterMs,
      ...(path==='/recovery/approve'&&code==='recovery_active'&&validRecoveryDate(recoveryExpiresAt)?{recoveryExpiresAt}:{})};
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

function validCloudActionRequest(value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const row=value as Record<string,any>,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 return uuid.test(row.id)&&uuid.test(row.effectId)&&Number.isSafeInteger(row.version)&&row.version>0&&row.available===false
  &&Object.hasOwn(translations.en,`cloudAction_${row.actionId}`)&&['ask-first','act-and-report'].includes(row.policy)
  &&['pending','approved','rejected','superseded'].includes(row.state)
  &&['occurrence','cell','target','proposal','evidence'].every(key=>typeof row[key]==='string'&&row[key].length>0&&row[key].length<=1000)
  &&typeof row.createdAt==='string'&&Number.isFinite(Date.parse(row.createdAt))
  &&[row.decidedAt,row.approvalExpiresAt].every(time=>time===null||typeof time==='string'&&Number.isFinite(Date.parse(time)))
  &&Array.isArray(row.events)&&row.events.length<=5&&row.events.every((event:any)=>event&&['proposed','approved','rejected','superseded','notice'].includes(event.kind)&&typeof event.at==='string'&&Number.isFinite(Date.parse(event.at)));
}
