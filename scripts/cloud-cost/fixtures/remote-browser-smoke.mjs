import { chromium } from 'playwright-core';
import { measureRemoteBrowser } from './browser.mjs';
import { withBrowserDiagnostics } from './browser-diagnostics.mjs';
const options = { chromium, staffHostname: 'staff.generated.example.test',
  email: 'owner@example.test', password: 'Generated local password' };
if (process.argv[2] === 'extra-config') options.raw = 'Generated private export canary';
process.stdout.write(JSON.stringify(await withBrowserDiagnostics(() => measureRemoteBrowser(options), text => process.stderr.write(text + '\n'))));
