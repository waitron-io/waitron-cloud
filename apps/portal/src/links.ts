import type { Locale } from './locale.ts';
export type CapturedLink = {token?: string; emailChangeToken?:string; requestId?: string; pairingCode?: string; recoveryId?: string; operatorVenueId?:string; locale?: Locale; invalid: boolean};
export function captureLink(url: URL, replace: (url: string) => void, historyState?: {pairingRequestId?: unknown;operatorVenueId?:unknown}): CapturedLink {
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
      || !pairingId.test(requests[0]!) || result.invalid) result.invalid = true;
    else if(url.pathname==='/recover')result.recoveryId=requests[0];else result.requestId = requests[0];
  }
  const changes=params.flatMap(p=>p.getAll('change'));
  if(changes.length){
    if(changes.length!==1||url.pathname!=='/account'||url.searchParams.has('change')||tokens.length||result.invalid||!/^[A-Za-z0-9_-]{43}$/.test(changes[0]!))result.invalid=true;
    else result.emailChangeToken=changes[0];
  }
  const codes = params.flatMap(p => p.getAll('code'));
  if (codes.length) {
    const code = codes[0]!;
    if (codes.length !== 1 || url.searchParams.has('code') || !result.requestId || result.invalid || !/^[0-9]{8}$/.test(code)) {
      return result.locale ? {invalid: true, locale: result.locale} : {invalid: true};
    }
    result.pairingCode = code;
  }
  if (!result.invalid && !result.requestId && ['/connect', '/login'].includes(url.pathname)) {
    const storedId = historyState?.pairingRequestId;
    if (typeof storedId === 'string' && pairingId.test(storedId)) result.requestId = storedId;
  }
  if(url.pathname==='/operator/venues'&&!result.invalid){
    const venues=params[1]!.getAll('venue');
    if(venues.length){
      if(venues.length===1&&pairingId.test(venues[0]!))result.operatorVenueId=venues[0];
      else result.invalid=true;
    }else if(!url.hash&&typeof historyState?.operatorVenueId==='string'&&pairingId.test(historyState.operatorVenueId)){
      result.operatorVenueId=historyState.operatorVenueId;
    }
  }
  return result;
}


export interface SetupPairingLink {requestId: string; state: string; codeChallenge: string}
const setupStorageKey = 'cloud.setupPairing';
const pairingToken = /^[A-Za-z0-9_-]{43}$/;
const pairingId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function validSetupPairingLink(value: Partial<SetupPairingLink>): value is SetupPairingLink {
  return typeof value.requestId === 'string' && pairingId.test(value.requestId)
    && typeof value.state === 'string' && pairingToken.test(value.state)
    && typeof value.codeChallenge === 'string' && pairingToken.test(value.codeChallenge);
}

export function forgetSetupPairingLink() {
  try { sessionStorage.removeItem(setupStorageKey); } catch { /* The current page can still sign in. */ }
}

export function captureSetupPairingLink(url: URL): SetupPairingLink | undefined {
  if (url.pathname !== '/login' && url.pathname !== '/signup') { forgetSetupPairingLink(); return; }
  if (url.pathname === '/login' && url.search) {
    forgetSetupPairingLink();
    const query = url.searchParams;
    const link = {requestId: query.get('request_id') ?? '', state: query.get('state') ?? '',
      codeChallenge: query.get('code_challenge') ?? ''};
    if (query.size !== 4 || query.get('code_challenge_method') !== 'S256' || !validSetupPairingLink(link)) return;
    try { sessionStorage.setItem(setupStorageKey, JSON.stringify({...link, expiresAt: Date.now() + 600_000})); }
    catch { /* The current page can still sign in. */ }
    return link;
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(setupStorageKey) ?? 'null');
    if (stored && typeof stored.expiresAt === 'number' && stored.expiresAt > Date.now() && validSetupPairingLink(stored)) {
      const {requestId, state, codeChallenge} = stored;
      return {requestId, state, codeChallenge};
    }
  } catch { /* Unavailable or invalid tab storage carries no authority. */ }
  forgetSetupPairingLink();
}

const pageReturnKey = 'cloud.emailRequestReturn';
type PageReturn = {path: string; pairingId?: string; recoveryId?: string; locale: Locale};

export function saveEmailRequestReturn(value: PageReturn) {
  history.replaceState({...history.state, emailRequestReturn: {...value, path: location.pathname}}, '');
  try {sessionStorage.setItem(pageReturnKey, JSON.stringify(value));} catch { /* Storage is optional. */ }
}

function emailRequestReturn(value: Partial<PageReturn> | null | undefined, path: string): PageReturn | undefined {
  if (value?.path !== path || (value.locale !== 'en' && value.locale !== 'es')) return;
  const id = (candidate: unknown) => typeof candidate === 'string' && pairingId.test(candidate) ? candidate : undefined;
  return {path, locale: value.locale, pairingId: id(value.pairingId), recoveryId: id(value.recoveryId)};
}

export function takeEmailRequestReturn(path: string): (PageReturn & {forwarded: boolean}) | undefined {
  let forwarded: ReturnType<typeof emailRequestReturn>;
  try {
    const raw = sessionStorage.getItem(pageReturnKey);
    sessionStorage.removeItem(pageReturnKey);
    if (raw) forwarded = emailRequestReturn(JSON.parse(raw), path);
  } catch { /* Unavailable or invalid tab storage carries no context. */ }
  if (forwarded) {
    history.replaceState({...history.state, emailRequestReturn: forwarded}, '');
    return {...forwarded, forwarded: true};
  }
  const restored = emailRequestReturn(history.state?.emailRequestReturn, path);
  return restored && {...restored, forwarded: false};
}
