import { applyTokens } from '@waitron-io/ui-core/tokens';
import { PortalApp } from './app.ts';
applyTokens(document.body);
new PortalApp(document.querySelector('#portal')!);
