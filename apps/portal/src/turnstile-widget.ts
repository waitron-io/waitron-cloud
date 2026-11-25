import type {Locale} from './locale.ts';

type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string; action: string; theme: 'auto'; language: Locale; size: 'normal' | 'compact'; 'response-field': false; 'refresh-expired': 'manual';
    callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void;
    'timeout-callback': () => void; 'unsupported-callback': () => void;
  }): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {interface Window {turnstile?: TurnstileApi}}

let loading: Promise<TurnstileApi> | undefined;
function sdk() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {clearTimeout(timer); script.remove(); reject(new Error('widget_unavailable'));};
    const timer = setTimeout(fail, 15000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {if (window.turnstile) {clearTimeout(timer); resolve(window.turnstile);} else fail();};
    script.onerror = fail;
    document.head.append(script);
  }).catch(error => {loading = undefined; throw error;});
  return loading;
}

class TurnstileWidget extends HTMLElement {
  siteKey = '';
  action = '';
  locale: Locale = 'en';
  #widget: string | undefined;
  #generation = 0;

  connectedCallback() {
    const generation = ++this.#generation;
    const current = () => this.isConnected && this.#generation === generation;
    const report = (token: string | null) => {
      if (current()) this.dispatchEvent(new CustomEvent('check-result', {detail: token}));
    };
    void sdk().then(api => {
      if (!current()) return;
      this.#widget = api.render(this, {
        sitekey: this.siteKey, action: this.action, theme: 'auto', language: this.locale,
        size: this.clientWidth < 300 ? 'compact' : 'normal', 'response-field': false, 'refresh-expired': 'manual',
        callback: report,
        'expired-callback': () => {
          if (!current()) return;
          report('');
          if (this.#widget !== undefined) api.reset(this.#widget);
        },
        'error-callback': () => report(null),
        'timeout-callback': () => report(null),
        'unsupported-callback': () => report(null),
      });
    }).catch(() => report(null));
  }

  disconnectedCallback() {
    this.#generation++;
    if (this.#widget !== undefined) {
      try {window.turnstile?.remove(this.#widget);}
      catch { /* Removing the container also removes any remaining provider frame. */ }
      finally {this.#widget = undefined; this.replaceChildren();}
    }
  }
}
customElements.define('turnstile-widget', TurnstileWidget);
