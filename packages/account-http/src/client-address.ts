import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { AccountHttpError } from './errors.ts';
export function canonicalIp(value: string): string {
  // Node's strict screen excludes abbreviated IPv4, ports and zone identifiers accepted by some parsers.
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) throw new AccountHttpError(400, 'invalid_input');
  return ipaddr.process(value).toString();
}
export function clientAddress(peer: string, forwarded: string | undefined, trustedProxyIps: readonly string[]): string {
  const source = canonicalIp(peer);
  const address = trustedProxyIps.includes(source) ? canonicalIp(forwarded?.trim() ?? '') : source;
  const parsed = ipaddr.process(address);
  if (parsed.kind() === 'ipv4') return parsed.toString();
  const bytes = parsed.toByteArray(); bytes.fill(0, 8);
  return `${ipaddr.fromByteArray(bytes).toString()}/64`;
}
