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
  const at = new Intl.DateTimeFormat(body.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: body.timeZone,
  }).format(new Date(body.facts.at));
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
