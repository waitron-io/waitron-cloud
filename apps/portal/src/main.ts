import { html, render } from 'lit';
import { applyTokens } from '@waitron-io/ui-core/tokens';
import '@waitron-io/ui-core/components/wt-card';
applyTokens(document.body);
render(html`<main><wt-card><h1>Waitron Cloud</h1></wt-card></main>`, document.querySelector('#portal')!);
