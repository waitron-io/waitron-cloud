import type {RelayStaffNotice} from './relay-payload.ts';

export const securityChanges = {
  password_changed: {en: 'Your password was changed.', es: 'Se cambió tu contraseña.'},
  passkey_added: {en: 'A passkey was added.', es: 'Se añadió una llave de acceso.'},
  passkey_removed: {en: 'A passkey was removed.', es: 'Se eliminó una llave de acceso.'},
  authenticator_set_up: {en: 'An authenticator was set up.', es: 'Se configuró un autenticador.'},
  authenticator_removed: {en: 'Your authenticator was removed.', es: 'Se eliminó tu autenticador.'},
  recovery_codes_regenerated: {en: 'Your recovery codes were regenerated.', es: 'Se regeneraron tus códigos de recuperación.'},
  email_changed: {en: 'Your sign-in email address changed.', es: 'Cambió tu correo de acceso.'},
  google_connected: {en: 'Google sign-in was connected.', es: 'Se conectó el acceso con Google.'},
  google_disconnected: {en: 'Google sign-in was disconnected.', es: 'Se desconectó el acceso con Google.'},
} as const;

export const builtInRoles = {
  staff: {en: 'Staff', es: 'Empleado'},
  supervisor: {en: 'Supervisor', es: 'Supervisor'},
  manager: {en: 'Manager', es: 'Encargado'},
  admin: {en: 'Admin', es: 'Administrador'},
} as const;

export function relayStaffNotice(body: RelayStaffNotice) {
  const language = body.locale.startsWith('es') ? 'es' : 'en';
  if (body.class === 'box_alert' || body.class === 'certificate_reminder') return relayBoxNotice(body);
  const at = noticeTime(body.locale, body.timeZone, body.facts.at);
  const venue = body.displayName;
  switch (body.class) {
    case 'email_changed': {
      const {editorName} = body.facts;
      return language === 'es' ? {
        subject: 'Se cambió tu correo de acceso',
        text: `${editorName} cambió el correo con el que entras en ${venue} el ${at}. Los mensajes de tu cuenta ahora van a la nueva dirección. Si no esperabas este cambio, avisa a un administrador del local.\n`,
      } : {
        subject: 'Your sign-in email was changed',
        text: `${editorName} changed the email address you sign in with at ${venue} on ${at}. Messages for your account now go to the new address. If you weren’t expecting this, tell a venue administrator.\n`,
      };
    }
    case 'security_change': {
      const change = securityChanges[body.facts.change][language];
      return language === 'es' ? {
        subject: 'Cambió la seguridad de tu cuenta',
        text: `${venue}\n\n${change} Cambio realizado el ${at}. Si no has sido tú, elimina los métodos de acceso que no reconozcas y cambia tu contraseña. Si no puedes entrar, pide ayuda a un administrador del local.\n`,
      } : {
        subject: 'Your account security changed',
        text: `${venue}\n\n${change} Changed on ${at}. If this wasn’t you, remove any sign-in method you don’t recognise and change your password. If you can’t sign in, ask a venue administrator for help.\n`,
      };
    }
    case 'role_membership_changed': {
      const {change, editorName} = body.facts;
      const role = 'builtInKey' in body.facts ? builtInRoles[body.facts.builtInKey][language] : body.facts.roleName;
      const added = change === 'added';
      return language === 'es' ? {
        subject: added ? 'Rol añadido' : 'Rol quitado',
        text: `${venue}\n\n${editorName} te ${added ? 'añadió al' : 'quitó del'} rol ${role} el ${at}.\n`,
      } : {
        subject: added ? 'Role added' : 'Role removed',
        text: `${venue}\n\n${editorName} ${added ? 'added you to' : 'removed you from'} ${role} on ${at}.\n`,
      };
    }
  }
}

type BoxNotice = Extract<RelayStaffNotice, {class: 'box_alert' | 'certificate_reminder'}>;
type ClockFacts = Extract<Extract<BoxNotice, {class: 'box_alert'}>['facts'], {code: 'clock.corrected'}>;

function noticeTime(locale: string, timeZone: string, timestamp: string): string {
  return new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short', timeZone})
    .format(new Date(timestamp));
}

function observedTime(locale: string, timestamp: string, offset: number): string {
  const minutes = Math.abs(offset);
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const remainder = String(minutes % 60).padStart(2, '0');
  return noticeTime(locale, `${offset < 0 ? '-' : '+'}${hours}:${remainder}`, timestamp);
}

function duration(locale: string, milliseconds: number): string {
  const units = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000], ['second', 1_000]] as const;
  const parts: string[] = [];
  let remaining = Math.abs(milliseconds);
  for (const [unit, size] of units) {
    const value = unit === 'second' && parts.length === 0 ? remaining / size : Math.floor(remaining / size);
    remaining -= value * size;
    if (value || parts.length === 0 && unit === 'second') {
      parts.push(new Intl.NumberFormat(locale, {style: 'unit', unit, unitDisplay: 'long'}).format(value));
    }
    if (parts.length === 2) break;
  }
  return new Intl.ListFormat(locale).format(parts);
}

function bytes(locale: string, count: number): string {
  const gigabytes = Math.round(count / 1e6) >= 1000;
  return new Intl.NumberFormat(locale, {
    style: 'unit', unit: gigabytes ? 'gigabyte' : 'megabyte', maximumFractionDigits: gigabytes ? 1 : 0,
  }).format(count / (gigabytes ? 1e9 : 1e6));
}

function clockNotice(locale: string, spanish: boolean, facts: ClockFacts): [string, string] {
  const before = observedTime(locale, facts.before, facts.beforeOffsetMinutes);
  const after = observedTime(locale, facts.after, facts.afterOffsetMinutes);
  const amount = duration(locale, facts.stepMs);
  const step = spanish
    ? `${facts.stepMs > 0 ? 'adelantó' : facts.stepMs < 0 ? 'atrasó' : 'cambió'} ${amount}`
    : `${facts.stepMs > 0 ? 'moved forward' : facts.stepMs < 0 ? 'moved back' : 'moved'} ${amount}`;
  if (facts.unverified) return spanish ? [
    'El servidor no pudo confirmar el cambio de hora',
    `El reloj marcaba ${before} antes y ${after} después. El servidor intentó corregirlo (${step}). Comprueba la hora en Sistema → Estado del servidor.`,
  ] : [
    'The box could not confirm the clock correction',
    `The clock read ${before} before and ${after} after. The box tried to correct it (${step}). Check the box's clock under System → Box status.`,
  ];

  let source: string;
  if (facts.source === 'staff') {
    const device = facts.device ? (spanish ? `la caja ${facts.device}` : `till ${facts.device}`) : (spanish ? 'una caja' : 'a till');
    const person = facts.person ?? (spanish ? 'un miembro del personal' : 'a staff member');
    source = spanish ? `Hora de ${device}, confirmada por ${person}.` : `Time from ${device}, confirmed by ${person}.`;
  } else if (facts.source === 'setup') {
    const device = spanish ? 'Hora del dispositivo de configuración o restauración' : 'Time from the setup or restore device';
    source = facts.person ? `${device} (${facts.person}).` : device + '.';
  } else {
    source = spanish ? `Hora del dispositivo de ${facts.person ?? 'un administrador'}.`
      : (facts.person ? `Time from ${facts.person}'s device.` : 'Time from an administrator’s device.');
  }
  return spanish
    ? ['Se corrigió el reloj del servidor', `${source} El reloj se ${step}, de ${before} a ${after}.`]
    : ["The box's clock was set", `${source} The clock ${step}, from ${before} to ${after}.`];
}

function relayBoxNotice(body: BoxNotice) {
  const spanish = body.locale.startsWith('es');
  const day = (date: string) => new Intl.DateTimeFormat(body.locale, {dateStyle: 'medium', timeZone: 'UTC'})
    .format(new Date(date + 'T00:00:00.000Z'));
  const render = (subject: string, message: string) => ({subject, text: `${body.displayName}\n\n${message}\n`});
  if (body.class === 'certificate_reminder') {
    const {facts} = body;
    const date = day(facts.date);
    if (facts.stage === 'expired') return spanish
      ? render('Caducó el certificado de la AEAT', `El certificado de la AEAT caducó el ${date}. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo en Ajustes del local.`)
      : render('AEAT certificate expired', `The AEAT certificate expired on ${date}. Sales continue, but fiscal records wait until you install a new one in Venue settings.`);
    const days = new Intl.NumberFormat(body.locale, {style: 'unit', unit: 'day', unitDisplay: 'long'}).format(facts.daysLeft);
    return spanish
      ? render('Caduca pronto el certificado de la AEAT', `El certificado de la AEAT caduca el ${date} (${facts.daysLeft === 0 ? 'hoy' : `dentro de ${days}`}). Instala uno nuevo en Ajustes del local antes de que caduque para evitar que los registros fiscales queden en espera.`)
      : render('AEAT certificate expires soon', `The AEAT certificate expires on ${date} (${facts.daysLeft === 0 ? 'today' : `in ${days}`}). Install a new certificate in Venue settings before it expires to keep fiscal records flowing.`);
  }
  switch (body.facts.code) {
    case 'storage.space_low':
      return spanish
        ? render('Al servidor le queda poco espacio en disco', 'Al servidor le quedan unos 2 GB o menos. Si se llena, no podrá guardar nada. Mira qué ocupa espacio en Sistema → Estado del servidor.')
        : render('The box is nearly out of disk space', 'The box has about 2 GB left or less. If it fills up, it cannot save anything. See what is using space under System → Box status.');
    case 'storage.disk_full':
      return spanish
        ? render('El servidor se ha quedado sin espacio', 'El servidor no puede guardar pedidos, cobros ni fichajes. En Sistema → Estado del servidor, pulsa Liberar. El botón borra solo archivos que el servidor ya no necesita.')
        : render('The box is out of disk space', 'The box cannot save orders, payments or clock-ins. Under System → Box status, choose Free. This button deletes only files the box no longer needs.');
    case 'backup.archives_deleted': {
      const {count, date, lastDate} = body.facts;
      const first = day(date);
      const dates = date === lastDate ? first : (spanish ? `del ${first} al ${day(lastDate)}` : `${first} to ${day(lastDate)}`);
      const copies = new Intl.NumberFormat(body.locale).format(count);
      return spanish
        ? render('Se borraron copias antiguas por falta de espacio', `El servidor borró ${count === 1 ? 'su copia de seguridad más antigua' : `sus ${copies} copias más antiguas`} (${dates}).`)
        : render('Old backups deleted due to low disk space', `The box deleted its ${count === 1 ? 'oldest backup' : `${copies} oldest backups`} (${dates}).`);
    }
    case 'backup.run_stopped': {
      const needed = bytes(body.locale, body.facts.neededBytes);
      const available = bytes(body.locale, body.facts.availableBytes);
      return spanish
        ? render('No se hizo la copia por falta de espacio', `La copia necesita ${needed} libres y el disco tiene ${available}.`)
        : render('Backup skipped due to low disk space', `The backup needs ${needed} free and the disk has ${available}.`);
    }
    case 'upgrade.rolled_back': {
      const {fromVersion, toVersion} = body.facts;
      return spanish
        ? render('El servidor revirtió una actualización', `La actualización a ${toVersion} no se completó. El servidor ha vuelto a la versión ${fromVersion}. Consulta Sistema → Estado del servidor.`)
        : render('The box rolled back an upgrade', `The upgrade to ${toVersion} did not complete. The box is back on ${fromVersion}. See System → Box status.`);
    }
    case 'clock.corrected':
      return render(...clockNotice(body.locale, spanish, body.facts));
  }
}
