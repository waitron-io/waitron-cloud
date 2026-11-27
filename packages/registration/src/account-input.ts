import type {AddressLookupCap} from './address-lookup-admission.ts';

export type AccountLocale = 'en' | 'es';
export interface AccountNotification { email: string; locale?: AccountLocale; }
export interface AccountEmail extends AccountNotification { token: string; expiresAt: string; }
export interface AccountSignInCheck extends AccountEmail { code: string; }
export const validLocale = (value: unknown): value is AccountLocale => value === 'en' || value === 'es';

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

export interface OwnerTransferMail extends AccountNotification {offerId:string;event:'invitation'|'accepted'|'cancelled'}
export function validOwnerTransferMail(message:AccountNotification):message is OwnerTransferMail {
 return 'offerId' in message&&typeof message.offerId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(message.offerId)
  &&'event' in message&&['invitation','accepted','cancelled'].includes(String(message.event));
}

export interface SignupVolumeNotice extends AccountNotification {
  event: 'signup_volume';
  accountId: string;
  day: string;
  threshold: number;
}

const noticeId=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export interface VenueSigningNotice extends AccountNotification {accountId:string;organisationId:string;venueId:string;domain:string}
export function validVenueSigningNotice(message:AccountNotification):message is VenueSigningNotice {
 return 'accountId' in message&&typeof message.accountId==='string'&&noticeId.test(message.accountId)
  &&'organisationId' in message&&typeof message.organisationId==='string'&&noticeId.test(message.organisationId)
  &&'venueId' in message&&typeof message.venueId==='string'&&noticeId.test(message.venueId)
  &&'domain' in message&&typeof message.domain==='string'&&normaliseEmail(`mail@${message.domain}`)===`mail@${message.domain}`;
}

export function validSignupVolumeNotice(message: AccountNotification): message is SignupVolumeNotice {
  return 'event' in message && message.event === 'signup_volume'
    && 'accountId' in message && typeof message.accountId === 'string' && noticeId.test(message.accountId)
    && 'day' in message && typeof message.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(message.day)
    && 'threshold' in message && typeof message.threshold === 'number' && Number.isSafeInteger(message.threshold) && message.threshold > 0;
}

export interface AddressCapNotice extends AccountNotification {
  event:'address_cap';
  accountId:string;
  bucket:AddressLookupCap['bucket'];
  period:string;
  venueId?:string;
  operatorVenueLink?:true;
}

export function validAddressCapNotice(message:AccountNotification):message is AddressCapNotice {
  if(!('event' in message)||message.event!=='address_cap'
    ||!('accountId' in message)||typeof message.accountId!=='string'||!noticeId.test(message.accountId)
    ||!('bucket' in message)||!('period' in message)||typeof message.period!=='string'
    ||'operatorVenueLink' in message&&(message.operatorVenueLink!==true||!('venueId' in message)))return false;
  switch(message.bucket){
    case 'paid_venue_month':
    case 'free_account_month':
      return /^\d{4}-\d{2}$/.test(message.period)&&'venueId' in message&&typeof message.venueId==='string'&&noticeId.test(message.venueId);
    case 'cloud_month':
    case 'free_month':
      return /^\d{4}-\d{2}$/.test(message.period)&&!('venueId' in message);
    case 'cloud_day':
    case 'free_day':
      return /^\d{4}-\d{2}-\d{2}$/.test(message.period)&&!('venueId' in message);
    default:
      return false;
  }
}

export function validOperatorWarning(message:AccountNotification):message is SignupVolumeNotice|AddressCapNotice {
  return validSignupVolumeNotice(message)||validAddressCapNotice(message);
}
