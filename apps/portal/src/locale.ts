export type Locale = 'en' | 'es';
export function chooseLocale(saved: string | null, languages: readonly string[]): Locale {
  if (saved === 'en' || saved === 'es') return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (base === 'en' || base === 'es') return base;
  }
  return 'en';
}
const en = {
  language:'Language', login:'Sign in', signup:'Create an account', completeSignup:'Complete your account',
  forgot:'Forgot your password?', reset:'Choose a new password', account:'Your account',
  email:'Email', password:'Password', newPassword:'New password', legalName:'Legal business name',
  soleTrader:'If you are a sole trader, use your own legal name.', differentOrg:'Use a different organisation name',
  orgName:'Organisation name', country:'Business country', spain:'Spain', show:'Show password', hide:'Hide password',
  continue:'Continue', create:'Create account', sendReset:'Send reset link', savePassword:'Save new password',
  signout:'Sign out', requestLink:'Request a new link', changeEmail:'Use another email address', resend:'Resend email',
  wait:'Please wait…', checkEmail:'Check your email', emailSent:'If this address can receive a link, it will arrive shortly. Check your spam folder too.',
  emailIntro:'Enter your email to get a link. To continue an earlier signup, reopen its email link.',
  resetIntro:'Enter the email you use for Waitron Cloud.', signupReady:'Your account is ready. Sign in to continue.',
  resetReady:'Your password has changed and existing sessions have ended. Sign in to continue.',
  accountIntro:'You are signed in to Waitron Cloud.', passwordHelp:'Use at least 15 characters and at most 1024 UTF-8 bytes.',
  emailError:'Enter a valid email address.', requiredPassword:'Enter your password.',
  nameError:'Enter a name of up to 200 characters, without control characters.',
  errors:'Please check the form', invalid:'Check your details and try again.',
  credentials:'The email or password is incorrect.', unavailable:'This service is temporarily unavailable. Try again.',
  sessionUnavailable:'We could not check your session. Try again.', checking:'Checking your session…', retry:'Try again',
  linkUnavailable:'This link is unavailable. It may have expired or already been used. Sign in or request a new link.',
  missingLink:'Reopen the link in your email, or request a new one.',
  uncertain:'We could not confirm the result. You can try signing in with the password you chose, or deliberately retry this form.',
  limited:'Too many requests. Wait before trying again.', cooldown:'You can try again in', seconds:'seconds.',
  logoutFailed:'We could not sign you out. Try again.', loginLink:'Already have an account?', signupLink:'New to Waitron Cloud?',
  forbidden:'Your request could not be verified. Reload this page and try again.',
  signedOut:'You have signed out.',
};
export type Copy = typeof en;
const es: Copy = {
  language:'Idioma', login:'Inicia sesión', signup:'Crea una cuenta', completeSignup:'Completa tu cuenta',
  forgot:'¿Has olvidado tu contraseña?', reset:'Elige una nueva contraseña', account:'Tu cuenta',
  email:'Correo electrónico', password:'Contraseña', newPassword:'Nueva contraseña', legalName:'Nombre legal del negocio',
  soleTrader:'Si eres autónomo, utiliza tu propio nombre legal.', differentOrg:'Usar otro nombre para la organización',
  orgName:'Nombre de la organización', country:'País del negocio', spain:'España', show:'Mostrar contraseña', hide:'Ocultar contraseña',
  continue:'Continuar', create:'Crear cuenta', sendReset:'Enviar enlace', savePassword:'Guardar nueva contraseña',
  signout:'Cerrar sesión', requestLink:'Solicitar un nuevo enlace', changeEmail:'Usar otra dirección de correo', resend:'Reenviar correo',
  wait:'Espera un momento…', checkEmail:'Revisa tu correo', emailSent:'Si esta dirección puede recibir un enlace, llegará en breve. Revisa también la carpeta de spam.',
  emailIntro:'Introduce tu correo para recibir un enlace. Para continuar un registro anterior, vuelve a abrir su enlace de correo.',
  resetIntro:'Introduce el correo que utilizas para Waitron Cloud.', signupReady:'Tu cuenta está lista. Inicia sesión para continuar.',
  resetReady:'Tu contraseña ha cambiado y se han cerrado las sesiones existentes. Inicia sesión para continuar.',
  accountIntro:'Has iniciado sesión en Waitron Cloud.', passwordHelp:'Utiliza al menos 15 caracteres y como máximo 1024 bytes UTF-8.',
  emailError:'Introduce una dirección de correo válida.', requiredPassword:'Introduce tu contraseña.',
  nameError:'Introduce un nombre de hasta 200 caracteres, sin caracteres de control.',
  errors:'Revisa el formulario', invalid:'Revisa tus datos y vuelve a intentarlo.',
  credentials:'El correo o la contraseña no son correctos.', unavailable:'El servicio no está disponible temporalmente. Vuelve a intentarlo.',
  sessionUnavailable:'No hemos podido comprobar tu sesión. Vuelve a intentarlo.', checking:'Comprobando tu sesión…', retry:'Volver a intentar',
  linkUnavailable:'Este enlace no está disponible. Puede haber caducado o haberse usado. Inicia sesión o solicita un nuevo enlace.',
  missingLink:'Vuelve a abrir el enlace de tu correo o solicita uno nuevo.',
  uncertain:'No hemos podido confirmar el resultado. Puedes intentar iniciar sesión con la contraseña que has elegido o volver a enviar este formulario.',
  limited:'Demasiadas solicitudes. Espera antes de volver a intentarlo.', cooldown:'Puedes volver a intentarlo en', seconds:'segundos.',
  logoutFailed:'No hemos podido cerrar tu sesión. Vuelve a intentarlo.', loginLink:'¿Ya tienes una cuenta?', signupLink:'¿Es tu primera visita a Waitron Cloud?',
  forbidden:'No hemos podido verificar la solicitud. Recarga esta página y vuelve a intentarlo.',
  signedOut:'Has cerrado sesión.',
};
export const translations: Record<Locale, Copy> = {en, es};
