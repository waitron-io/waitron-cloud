import {setTimeout as delay} from 'node:timers/promises';

export function readinessReply(status, body) {
  if (status !== 200) return {ready: false, phase: 'http_status', status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0};
  try {
    if (typeof JSON.parse(body)?.available === 'boolean') return {ready: true, phase: 'ready'};
  } catch {}
  return {ready: false, phase: 'response_shape'};
}
export function readinessError(error) {
  const phase = {ECONNREFUSED: 'connection_refused', ECONNRESET: 'connection_reset', ETIMEDOUT: 'timeout',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'tls_untrusted', SELF_SIGNED_CERT_IN_CHAIN: 'tls_untrusted',
    ERR_TLS_CERT_ALTNAME_INVALID: 'tls_hostname', CERT_HAS_EXPIRED: 'tls_expired'}[error?.code];
  return {ready: false, phase: typeof phase === 'string' ? phase : 'transport'};
}
export async function waitForGatewayReady(probe, {now = Date.now, wait = delay} = {}) {
  const deadline = now() + 30000;
  let last = {ready: false, phase: 'not_started'};
  while (now() < deadline) {
    try {last = await probe(); if (last?.ready === true) return;}
    catch {last = {ready: false, phase: 'probe_command'};}
    await wait(100);
  }
  const phases = ['not_started', 'http_status', 'response_shape', 'connection_refused', 'connection_reset', 'timeout', 'tls_untrusted', 'tls_hostname', 'tls_expired', 'transport', 'probe_command'];
  const phase = phases.includes(last?.phase) ? last.phase : 'invalid_probe';
  const status = phase === 'http_status' && Number.isInteger(last.status) && last.status >= 100 && last.status <= 599 ? `, status=${last.status}` : '';
  throw Error(`Generated local gateway readiness failed (phase=${phase}${status})`);
}
