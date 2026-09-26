import type {PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';

export type PasskeySummary = {id: string; createdAt: string; lastUsedAt: string | null};
export type RegistrationOptions = {ceremonyId: string; options: PublicKeyCredentialCreationOptionsJSON};
export type AuthenticationOptions = {ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const encoded = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value);

export function validPasskeySummary(value: unknown): value is PasskeySummary {
  return object(value) && typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && (value.lastUsedAt === null || (typeof value.lastUsedAt === 'string' && Number.isFinite(Date.parse(value.lastUsedAt))));
}

export function validPasskeyList(value: unknown): value is {passkeys: PasskeySummary[]} {
  return object(value) && Array.isArray(value.passkeys) && value.passkeys.length <= 100 && value.passkeys.every(validPasskeySummary);
}

export function validRegistrationOptions(value: unknown): value is RegistrationOptions {
  if (!object(value) || typeof value.ceremonyId !== 'string' || !UUID.test(value.ceremonyId) || !object(value.options)) return false;
  const {options} = value;
  return encoded(options.challenge) && object(options.rp) && typeof options.rp.id === 'string' && !!options.rp.id
    && typeof options.rp.name === 'string' && !!options.rp.name && object(options.user) && encoded(options.user.id)
    && typeof options.user.name === 'string' && !!options.user.name && typeof options.user.displayName === 'string' && !!options.user.displayName
    && Array.isArray(options.pubKeyCredParams) && options.pubKeyCredParams.length > 0
    && options.pubKeyCredParams.every(parameter => object(parameter) && parameter.type === 'public-key' && Number.isInteger(parameter.alg));
}

export function validAuthenticationOptions(value: unknown): value is AuthenticationOptions {
  if (!object(value) || typeof value.ceremonyId !== 'string' || !UUID.test(value.ceremonyId) || !object(value.options)) return false;
  return encoded(value.options.challenge) && typeof value.options.rpId === 'string' && !!value.options.rpId
    && (!('userVerification' in value.options) || ['required', 'preferred', 'discouraged'].includes(String(value.options.userVerification)));
}
