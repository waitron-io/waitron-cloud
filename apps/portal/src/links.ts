import type { Locale } from './locale.ts';
export type CapturedLink = {token?: string; requestId?: string; recoveryId?: string; locale?: Locale; invalid: boolean};
export function captureLink(url: URL, replace: (url: string) => void): CapturedLink {
  const params = [url.searchParams, new URLSearchParams(url.hash.slice(1))];
  const tokens = params.flatMap(p => p.getAll('token'));
  const languages = params.flatMap(p => p.getAll('lang'));
  // Scrub even rejected links before rendering or making a request.
  if (url.search || url.hash) replace(url.pathname);
  const result: CapturedLink = {invalid: false};
  if (tokens.length) {
    if (tokens.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(tokens[0]!) || !['/signup', '/reset-password'].includes(url.pathname)) result.invalid = true;
    else result.token = tokens[0];
  }
  if (languages.length === 1 && (languages[0] === 'en' || languages[0] === 'es')) result.locale = languages[0];
  const requests = params.flatMap(p => p.getAll('request'));
  if (requests.length) {
    if (requests.length !== 1 || url.searchParams.has('request') || !['/connect','/recover'].includes(url.pathname)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requests[0]!) || result.invalid) result.invalid = true;
    else if(url.pathname==='/recover')result.recoveryId=requests[0];else result.requestId = requests[0];
  }
  return result;
}
