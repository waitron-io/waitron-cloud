export interface AccountEmail { email: string; token: string; expiresAt: string; }

export function validNewPassword(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value) <= 1024 && [...value].length >= 15;
}

export function normaliseEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 254) return undefined;
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  const local = parts[0] ?? '';
  const domain = parts[1] ?? '';
  const labels = domain.split('.');
  // Start with ASCII dot-atom addresses; quoted local parts and SMTPUTF8 need provider support.
  if (parts.length !== 2 || local.length > 64 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)
    || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return undefined;
  return email;
}
