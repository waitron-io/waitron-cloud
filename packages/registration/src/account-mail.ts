import {validServiceAlert,type ServiceAlert} from './service-alert.ts';
import { validLocale, type AccountEmail, type AccountNotification } from './account-input.ts';
export type AccountMailKind = 'verification' | 'password_reset' | 'password_changed' | 'service_alert';
const copy = {
  en: {
    verification: 'Verify your Waitron Cloud email', password_reset: 'Reset your Waitron Cloud password',
    password_changed: 'Your Waitron Cloud password changed',
    changed: 'Your Waitron Cloud password has changed. Existing sessions have ended.\nIf you did not make this change, request another password reset.',
    expiry: 'This single-use link expires at', ignore: 'If you did not request this email, you can ignore it.',
  },
  es: {
    verification: 'Verifica tu correo de Waitron Cloud', password_reset: 'Restablece tu contraseña de Waitron Cloud',
    password_changed: 'Tu contraseña de Waitron Cloud ha cambiado',
    changed: 'Tu contraseña de Waitron Cloud ha cambiado. Se han cerrado las sesiones existentes.\nSi no has realizado este cambio, solicita otro restablecimiento de contraseña.',
    expiry: 'Este enlace de un solo uso caduca el', ignore: 'Si no has solicitado este correo, puedes ignorarlo.',
  },
};
export function accountMail(origin: URL, kind: AccountMailKind, message: AccountEmail | AccountNotification | ServiceAlert): {subject: string; text: string} {
  if (message.locale !== undefined && !validLocale(message.locale)) throw new Error('Invalid account email');
  const locale = message.locale ?? 'en';
  const text = copy[locale];
  if(kind==='service_alert'){
    if(!validServiceAlert(message))throw new Error('Invalid account email');
    const subjects=locale==='es'?{open:'Waitron Cloud: un local necesita atención',recovered:'Waitron Cloud: comprobación recuperada'}:{open:'Waitron Cloud: a venue needs attention',recovered:'Waitron Cloud: venue check recovered'};
    const issues=locale==='es'?{
      disconnected:'Cloud no recibe contacto de este local desde hace al menos 15 minutos. Comprueba su conexión a internet y el servidor Waitron.',
      snapshot_stale:'No hay una instantánea verificada de las últimas 48 horas. Comprueba las copias de seguridad del servidor.',
      verification_failed:'La comprobación de restauración de la última instantánea ha fallado. Conserva las copias anteriores verificadas; Cloud vuelve a intentarlo automáticamente.',
    }:{
      disconnected:'Cloud has not heard from this venue for at least 15 minutes. Check its internet connection and Waitron server.',
      snapshot_stale:'There is no verified snapshot from the last 48 hours. Check the server’s backups.',
      verification_failed:'The latest snapshot failed its restore check. Keep older verified copies; Cloud retries automatically.',
    };
    const labels=locale==='es'?{disconnected:'Contacto con Cloud',snapshot_stale:'Antigüedad de las instantáneas',verification_failed:'Verificación de instantáneas'}:{disconnected:'Contact with Cloud',snapshot_stale:'Snapshot freshness',verification_failed:'Snapshot verification'};
    const detail=message.state==='open'?issues[message.issue]:locale==='es'?'La condición que provocó esta alerta ya no está presente. Consulta el estado actual de los servicios en tu cuenta.':'The condition that caused this alert is no longer present. Check your account for current service status.';
    return {subject:subjects[message.state],text:[subjects[message.state],'',`${locale==='es'?'Local':'Venue'}: ${message.venueId}`,labels[message.issue],detail,'',new URL('/account',origin).href].join('\n')};
  }
  if (kind === 'password_changed') return {subject: text.password_changed, text: text.changed};
  if (!('token' in message)) throw new Error('Invalid account email');
  const link = new URL(kind === 'verification' ? '/signup' : '/reset-password', origin);
  link.hash = new URLSearchParams({token: message.token, lang: locale}).toString();
  const expiry = new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC'}).format(new Date(message.expiresAt));
  return {subject: text[kind], text: [text[kind], '', link.href, '', `${text.expiry} ${expiry}.`, text.ignore].join('\n')};
}
