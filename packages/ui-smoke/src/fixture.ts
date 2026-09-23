import { html, render } from 'lit';
import { applyTokens } from '@waitron-io/ui-core/tokens';
import '@waitron-io/ui-core/components/wt-card';
import '@waitron-io/ui-core/components/wt-input';
import '@waitron-io/ui-core/components/wt-button';

applyTokens(document.body);
let count = 0;
render(html`
  <main>
    <wt-card><h1>Cloud package check</h1>
      <wt-input id="email" label="Email" name="email" autocomplete="email"></wt-input>
      <wt-button id="continue" @click=${() => { document.querySelector('output')!.textContent = String(++count); }}>Continue</wt-button>
      <output aria-label="Submissions">0</output>
    </wt-card>
  </main>
`, document.body);
document.body.style.backgroundColor = 'var(--wt-color-bg)';
document.body.dataset.ready = 'true';
