import type {Page} from 'playwright';
import {startPortalFixture} from './fixtures.ts';

export function startTurnstilePortalFixture() {
  const siteverify: typeof fetch = async (_, options) => {
    const token = (options?.body as URLSearchParams).get('response') ?? '';
    const action = /^(signup|password_reset)-proof-\d+$/.exec(token)?.[1];
    return Response.json({success: !!action, hostname: 'localhost', action});
  };
  return startPortalFixture(undefined, undefined, undefined, undefined, false, undefined, undefined, undefined, undefined, undefined, siteverify);
}


export async function interceptTurnstile(page: Page, {blocked = () => false, automatic = false}: {blocked?: () => boolean; automatic?: boolean} = {}) {
  return page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => {
    if (blocked()) return route.abort();
    return route.fulfill({contentType: 'application/javascript', body: `
      let sequence = 0;
      const widgets = new Map();
      window.turnstile = {
        render(element, options) {
          const id = String(++sequence);
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = options.language === 'es' ? 'Verificar (simulación)' : 'Verify (stand-in)';
          button.style.cssText = options.size === 'compact'
            ? 'width:150px;height:140px;color-scheme:light dark' : 'width:300px;height:65px;color-scheme:light dark';
          button.onclick = () => options.callback(options.action + '-proof-' + (++sequence));
          button.addEventListener('expire-fixture', () => options['expired-callback']());
          button.addEventListener('error-fixture', () => options['error-callback']());
          element.append(button);
          widgets.set(id, button);
          if (${automatic}) queueMicrotask(() => button.click());
          return id;
        },
        reset(id) { widgets.get(id).focus(); },
        remove(id) { widgets.get(id)?.remove(); widgets.delete(id); },
      };
    `});
  });
}
