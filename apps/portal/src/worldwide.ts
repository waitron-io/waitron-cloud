import {html, render} from 'lit';
import {applyTokens} from '@waitron-io/ui-core/tokens';
import '@waitron-io/ui-core/components/wt-button';
import '@waitron-io/ui-core/components/wt-input';
import {submitOnEnter} from '@waitron-io/ui-core/submit-on-enter';
const copy = {
  en:{language:'Language',signin:'Admin sign-in',passkey:'Sign in with passkey',secret:'Enrolment secret',create:'Create passkey',
    help:'For first access or a lost passkey, ask your console administrator for an enrolment secret. It expires after 10 minutes.',
    health:'Country readiness',detail:'This checks the country API and its database schema. The outside availability check is separate.',ready:'Ready',unavailable:'Unavailable',refresh:'Refresh',out:'Sign out',
    error:'Could not finish. Try again. For a new enrolment secret, contact your console administrator.',cancelled:'Passkey cancelled. Try again.',unsupported:'Passkeys need a current browser in a secure connection. Use another browser or ask your console administrator.',busy:'Working…'},
  es:{language:'Idioma',signin:'Acceso de administración',passkey:'Acceder con llave de acceso',secret:'Secreto de registro',create:'Crear llave de acceso',
    help:'Para el primer acceso o si pierdes tu llave, pide un secreto de registro a quien administre la consola. Caduca a los 10 minutos.',
    health:'Disponibilidad por país',detail:'Comprueba la API del país y el esquema de su base de datos. La comprobación externa es independiente.',ready:'Disponible',unavailable:'No disponible',refresh:'Actualizar',out:'Cerrar sesión',
    error:'No se ha podido completar. Inténtalo de nuevo. Para obtener otro secreto de registro, contacta con quien administre la consola.',cancelled:'Llave de acceso cancelada. Inténtalo de nuevo.',unsupported:'Las llaves de acceso necesitan un navegador actualizado y una conexión segura. Usa otro navegador o contacta con quien administre la consola.',busy:'Un momento…'},
};
type Country = {countryCode:string;origin:string;status:'ready'|'unavailable'};
const root = document.querySelector<HTMLElement>('#portal')!;
let locale: 'en'|'es' = navigator.language.startsWith('es') ? 'es' : 'en';
let signedIn=false, busy=false, secret='', error: 'error'|'cancelled'|'unsupported'|undefined;
let countries: Country[]=[];
applyTokens(document.body);
const supported = typeof PublicKeyCredential !== 'undefined' && !!PublicKeyCredential.parseCreationOptionsFromJSON && !!PublicKeyCredential.parseRequestOptionsFromJSON && !!PublicKeyCredential.prototype.toJSON;
async function request(path:string, body?:object) {
  const response = await fetch('/api/console/'+path,{method:body ? 'POST':'GET',credentials:'same-origin',headers:body ? {'content-type':'application/json','x-csrf-token':document.cookie.split('; ').find(value => value.startsWith(location.protocol==='https:'?'__Host-cloud_csrf=':'cloud_csrf='))?.split('=')[1] ?? ''} : {},body:body ? JSON.stringify(body):undefined});
  if (!response.ok) {if(response.status===401) signedIn=false; throw new Error('Request refused');}
  return response.status===204 ? undefined : response.json();
}
async function action(run:()=>Promise<void>) {
  if (busy) return; busy=true;error=undefined;draw();
  try {await run();} catch (cause) {error=cause instanceof DOMException && cause.name==='NotAllowedError' ? 'cancelled':'error';}
  finally {busy=false;draw();root.querySelector<HTMLElement>('h1')?.focus();}
}
async function health() {countries=await request('countries');}
async function passkey(enrol:boolean) {
  if (!supported) {error='unsupported';draw();return;}
  await action(async () => {
    const issued = await request(enrol?'enrol/options':'signin/options',enrol ? {secret}:{});
    const credential = (enrol
      ? await navigator.credentials.create({publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(issued.options)})
      : await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(issued.options)})) as PublicKeyCredential|null;
    if (!credential) throw new Error('No passkey');
    await request(enrol?'enrol/verify':'signin/verify',{ceremonyId:issued.ceremonyId,response:credential.toJSON(),...(enrol?{secret}:{})});
    secret='';signedIn=true;await health();
  });
}
function draw() {
  const c=copy[locale];document.documentElement.lang=locale;document.title=(signedIn?c.health:c.signin)+' · Waitron Cloud';
  render(html`<header><a class="brand" href="/">Waitron Cloud</a><label class="language">${c.language}<select aria-label=${c.language} .value=${locale} @change=${(event:Event)=>{locale=(event.target as HTMLSelectElement).value as 'en'|'es';draw();}}><option value="en">English</option><option value="es">Español</option></select></label></header>
    <main aria-busy=${String(busy)}><h1 tabindex="-1">${signedIn?c.health:c.signin}</h1>
    ${error ? html`<p role="alert">${c[error]}</p>`:''}
    ${signedIn ? html`<p class="help">${c.detail}</p><ul class="console-countries">${countries.map(country=>html`<li><strong>${new Intl.DisplayNames([locale],{type:'region'}).of(country.countryCode)}</strong><p>${country.status==='ready'?c.ready:c.unavailable}</p><a href=${country.origin}>${country.origin}</a></li>`)}</ul>
      <wt-button ?disabled=${busy} @click=${()=>action(health)}>${c.refresh}</wt-button>
      <button class="text-button" ?disabled=${busy} @click=${()=>action(async()=>{await request('signout',{});signedIn=false;countries=[];})}>${c.out}</button>`
      : html`<wt-button ?disabled=${busy||!supported} @click=${()=>passkey(false)}>${c.passkey}</wt-button>
        ${!supported ? html`<p role="status">${c.unsupported}</p>`:''}
        <p class="help" id="enrol-help">${c.help}</p><wt-input .label=${c.secret} type="password" autocomplete="off" .disabled=${busy} .value=${secret} @wt-change=${(event:CustomEvent<{value:string}>)=>{secret=event.detail.value;}} @keydown=${(event:KeyboardEvent)=>submitOnEnter(event,root.querySelector("#enrol"))}></wt-input>
        <wt-button id="enrol" ?disabled=${busy||!supported} @click=${()=>passkey(true)}>${c.create}</wt-button>`}
    <p role="status">${busy?c.busy:''}</p></main>`,root);
}
draw();
void request('session').then(async()=>{signedIn=true;await health();draw();}).catch(()=>undefined);
