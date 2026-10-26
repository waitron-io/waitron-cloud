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
      public_route_failed:'El sitio público falló en la última comprobación externa. Comprueba la conexión a internet del local. Abre Configurar acceso remoto y comprueba el nombre seleccionado y el estado. Los cambios de pasarela y certificado aún requieren herramientas de operador.',
      staff_route_failed:'El acceso del personal falló en la última comprobación externa. Comprueba la conexión a internet del local. Abre Configurar acceso remoto y comprueba el nombre seleccionado y el estado. Los cambios de pasarela y certificado aún requieren herramientas de operador.',
      public_probe_stale:'La supervisión del sitio público es desconocida porque no hay una comprobación externa reciente. Usa Actualizar estado para buscar nuevas comprobaciones. La falta de una comprobación reciente no confirma una caída.',
      staff_probe_stale:'La supervisión del acceso del personal es desconocida porque no hay una comprobación externa reciente. Usa Actualizar estado para buscar nuevas comprobaciones. La falta de una comprobación reciente no confirma una caída.',
      public_certificate_expiring:'El certificado del sitio público caduca pronto. Abre Configurar acceso remoto y comprueba el nombre seleccionado y el estado. La renovación y la instalación aún requieren herramientas de operador. Usa Actualizar estado para buscar una fecha de caducidad más reciente.',
      staff_certificate_expiring:'El certificado del acceso del personal caduca pronto. Abre Configurar acceso remoto y comprueba el nombre seleccionado y el estado. La renovación y la instalación aún requieren herramientas de operador. Usa Actualizar estado para buscar una fecha de caducidad más reciente.',
    }:{
      disconnected:'Cloud has not heard from this venue for at least 15 minutes. Check its internet connection and Waitron server.',
      snapshot_stale:'There is no verified snapshot from the last 48 hours. Check the server’s backups.',
      verification_failed:'The latest snapshot failed its restore check. Keep older verified copies; Cloud retries automatically.',
      public_route_failed:'The public website failed its latest external check. Check the venue internet connection. Open Set up remote access and check the selected hostname and status. Gateway and certificate changes still require operator tools.',
      staff_route_failed:'Staff access failed its latest external check. Check the venue internet connection. Open Set up remote access and check the selected hostname and status. Gateway and certificate changes still require operator tools.',
      public_probe_stale:'Public website monitoring is unknown because no recent external check is available. Use Refresh status to look for new checks. A missing recent check does not confirm an outage.',
      staff_probe_stale:'Staff access monitoring is unknown because no recent external check is available. Use Refresh status to look for new checks. A missing recent check does not confirm an outage.',
      public_certificate_expiring:'The public website certificate expires soon. Open Set up remote access and check the selected hostname and status. Renewal and installation still require operator tools. Use Refresh status to look for a newer expiry date.',
      staff_certificate_expiring:'The staff access certificate expires soon. Open Set up remote access and check the selected hostname and status. Renewal and installation still require operator tools. Use Refresh status to look for a newer expiry date.',
    };
    const labels=locale==='es'?{disconnected:'Contacto con Cloud',snapshot_stale:'Antigüedad de las instantáneas',verification_failed:'Verificación de instantáneas',public_route_failed:'Sitio público',staff_route_failed:'Acceso del personal',public_probe_stale:'Sitio público',staff_probe_stale:'Acceso del personal',public_certificate_expiring:'Sitio público',staff_certificate_expiring:'Acceso del personal'}:{disconnected:'Contact with Cloud',snapshot_stale:'Snapshot freshness',verification_failed:'Snapshot verification',public_route_failed:'Public website',staff_route_failed:'Staff access',public_probe_stale:'Public website',staff_probe_stale:'Staff access',public_certificate_expiring:'Public website',staff_certificate_expiring:'Staff access'};
    const subject=message.notification==='reminder'?(locale==='es'?'Waitron Cloud: un local sigue necesitando atención':'Waitron Cloud: a venue still needs attention'):subjects[message.state];
    const detail=message.notification==='reminder'?(locale==='es'?'Esta incidencia sigue abierta. Consulta el estado actual de los servicios en tu cuenta.':'This issue is still open. Check your account for current service status.'):message.state==='open'?issues[message.issue]:locale==='es'?'La condición que provocó esta alerta ya no está presente. Consulta el estado actual de los servicios en tu cuenta.':'The condition that caused this alert is no longer present. Check your account for current service status.';
    const when=(value:string,label:string)=>`${label}: ${new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'}).format(new Date(value))}.`;
    return {subject,text:[subject,'',`${locale==='es'?'Local':'Venue'}: ${message.venueId}`,labels[message.issue],detail,...(message.checkedAt?['',when(message.checkedAt,locale==='es'?'Última comprobación externa':'Last external check')]:[]),...(message.certificateNotAfter?[when(message.certificateNotAfter,locale==='es'?'El certificado caduca':'The certificate expires')]:[]),'',new URL('/account',origin).href].join('\n')};
  }
  if (kind === 'password_changed') {
    const link = new URL('/forgot-password', origin);
    link.hash = new URLSearchParams({lang: locale}).toString();
    return {subject: text.password_changed, text: [text.changed, '', link.href].join('\n')};
  }
  if (!('token' in message)) throw new Error('Invalid account email');
  const link = new URL(kind === 'verification' ? '/signup' : '/reset-password', origin);
  link.hash = new URLSearchParams({token: message.token, lang: locale}).toString();
  const expiry = new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'long', timeZone: 'UTC'}).format(new Date(message.expiresAt));
  return {subject: text[kind], text: [text[kind], '', link.href, '', `${text.expiry} ${expiry}.`, text.ignore].join('\n')};
}
