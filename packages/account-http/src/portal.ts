import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export type PortalAssets = ReadonlyMap<string, {body: Uint8Array; contentType: string}>;
export const securityHeaders = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
};
export async function loadPortalAssets(directory: string): Promise<PortalAssets> {
  const assets = new Map<string, {body: Uint8Array; contentType: string}>();
  for (const [name, contentType] of [['index.html', 'text/html'], ['app.js', 'text/javascript'], ['app.css', 'text/css']] as const) {
    const body = await readFile(join(directory, name));
    if (!body.length || body.length > 4 * 1024 * 1024) throw new Error('Invalid portal build');
    assets.set(`/${name}`, {body, contentType: `${contentType}; charset=utf-8`});
  }
  return assets;
}
const documents = new Set(['/', '/signup', '/login', '/forgot-password', '/reset-password', '/account', '/connect', '/recover']);
const errors = {
  en: {
    400: ['Invalid address', 'This address is not valid. Check the link and try again.'],
    404: ['Page not found', 'This page does not exist.'],
    405: ['Page unavailable', 'This page cannot be opened this way.'],
    503: ['Service unavailable', 'Waitron Cloud is temporarily unavailable. Try again shortly.'],
    return: 'Return to Waitron Cloud',
  },
  es: {
    400: ['Dirección no válida', 'Esta dirección no es válida. Comprueba el enlace y vuelve a intentarlo.'],
    404: ['Página no encontrada', 'Esta página no existe.'],
    405: ['Página no disponible', 'Esta página no se puede abrir de esta forma.'],
    503: ['Servicio no disponible', 'Waitron Cloud no está disponible temporalmente. Vuelve a intentarlo en unos instantes.'],
    return: 'Volver a Waitron Cloud',
  },
} as const;
function preferredLocale(header: string | null): 'en' | 'es' {
  const choices = (header ?? '').split(',').flatMap((part, index) => {
    const [rawTag, ...parameters] = part.trim().toLowerCase().split(';');
    const locale = rawTag?.split('-')[0];
    if (locale !== 'en' && locale !== 'es') return [];
    const qualityParameter = parameters.map(value => value.trim()).find(value => value.startsWith('q='));
    const quality = qualityParameter === undefined ? 1 : Number(qualityParameter.slice(2));
    if (!Number.isFinite(quality) || quality <= 0 || quality > 1) return [];
    return [{locale, quality, index} as const];
  });
  choices.sort((left, right) => right.quality - left.quality || left.index - right.index);
  return choices[0]?.locale ?? 'en';
}
export function portalErrorResponse(request: Request, status: 400 | 404 | 405 | 503): Response {
  const locale = preferredLocale(request.headers.get('accept-language'));
  const copy = errors[locale]; const [title, detail] = copy[status];
  const encoded = new TextEncoder().encode(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><title>${title} · Waitron Cloud</title><style>body{font-family:system-ui,sans-serif;line-height:1.5;margin:0}main{box-sizing:border-box;max-width:32rem;margin:10vh auto;padding:1.5rem}h1{line-height:1.2}a{text-underline-offset:.15em}</style><main><h1>${title}</h1><p>${detail}</p><p><a href="/">${copy.return}</a></p></main></html>`);
  return new Response(request.method === 'HEAD' ? null : encoded, {status, headers: {
    ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(encoded.byteLength),
    ...(status === 405 ? {Allow: 'GET, HEAD'} : {}),
    ...(status === 503 ? {'Retry-After': '1'} : {}),
  }});
}
export function portalResponse(request: Request, assets: PortalAssets): Response {
  const url = new URL(request.url);
  const failure = (status: 400 | 404 | 405) => portalErrorResponse(request, status);
  if (url.search && !['/signup', '/reset-password'].includes(url.pathname)) return failure(400);
  if (!['GET', 'HEAD'].includes(request.method)) return failure(405);
  const key = documents.has(url.pathname) ? '/index.html' : ['/app.js', '/app.css'].includes(url.pathname) ? url.pathname : '';
  const asset = assets.get(key);
  if (!asset) return failure(404);
  // Stream shared bytes to avoid materializing a separate body for each connection.
  const body = request.method === 'HEAD' ? null : new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(asset.body); controller.close(); },
  });
  return new Response(body, {headers: {
    ...securityHeaders, 'Content-Type': asset.contentType, 'Content-Length': String(asset.body.byteLength),
  }});
}
