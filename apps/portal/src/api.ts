export type ApiResult<T> = {ok: true; value: T} | {ok: false; status: number; code: string; retryAfterMs: number};
function validResult(path: string, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const account = typeof data.accountId === 'string' && data.accountId.length > 0;
  if (path === '/session' || path === '/session/activity') return account && typeof data.expiresAt === 'string' && Number.isFinite(Date.parse(data.expiresAt));
  if (path === '/login') return account;
  if (path === '/signup/complete') return account && typeof data.organisationId === 'string' && typeof data.legalBusinessId === 'string';
  if (path.endsWith('/request')) return data.status === 'accepted';
  return path === '/password-reset/complete' && data.status === 'completed';
}
export async function accountRequest<T>(path: string, body?: Record<string, string>): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (path === '/session/activity' || path === '/logout') {
    const name = location.protocol === 'https:' ? '__Host-cloud_csrf' : 'cloud_csrf';
    const values = document.cookie.split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
    headers['X-CSRF-Token'] = values.length === 1 ? values[0]!.slice(name.length + 1) : '';
  }
  try {
    const response = await fetch(`/api/account${path}`, {method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers, ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(15_000)});
    const retry = response.headers.get('retry-after') ?? '';
    const retryAfterMs = Math.max(0, /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) || 0;
    if (response.ok && path === '/logout' && response.status === 204) return {ok: true, value: undefined as T};
    const value: unknown = await response.json().catch(() => null);
    if (response.ok && validResult(path, value)) return {ok: true, value: value as T};
    const codes = ['invalid_input', 'credentials_invalid', 'unauthenticated', 'forbidden', 'link_unavailable', 'rate_limited', 'temporarily_unavailable'];
    const code = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' && codes.includes(value.error)
      ? value.error : 'temporarily_unavailable';
    return {ok: false, status: response.ok ? 503 : response.status, code, retryAfterMs};
  } catch { return {ok: false, status: 0, code: 'network_error', retryAfterMs: 0}; }
}
