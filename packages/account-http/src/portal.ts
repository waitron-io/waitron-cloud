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
const documents = new Set(['/', '/signup', '/login', '/forgot-password', '/reset-password', '/account']);
export function portalResponse(request: Request, assets: PortalAssets): Response {
  const url = new URL(request.url);
  const failure = (status: number) => new Response(null, {status, headers: securityHeaders});
  if (url.search && !['/signup', '/reset-password'].includes(url.pathname)) return failure(400);
  if (!['GET', 'HEAD'].includes(request.method)) return failure(405);
  const key = documents.has(url.pathname) ? '/index.html' : ['/app.js', '/app.css'].includes(url.pathname) ? url.pathname : '';
  const asset = assets.get(key);
  if (!asset) return failure(404);
  return new Response(request.method === 'HEAD' ? null : Buffer.from(asset.body), {headers: {
    ...securityHeaders, 'Content-Type': asset.contentType, 'Content-Length': String(asset.body.byteLength),
  }});
}
