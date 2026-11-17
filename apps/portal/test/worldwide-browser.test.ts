import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {worldwideDatabase, consolePort} from '../../../packages/account-http/test/worldwide-fixture.ts';
import {ConsoleAuth, initializeConsole} from '../../../packages/account-http/src/worldwide/auth.ts';
import {startConsole, loadConsoleAssets} from '../../../packages/account-http/src/worldwide/server-cli.ts';
import {CountryReadiness} from '../../../packages/account-http/src/worldwide/countries.ts';
import {addVirtualAuthenticator} from './fixtures.ts';
test('admin enrols and signs in with a real passkey, reads readiness, and signs out',async t => {
  const db = await worldwideDatabase(); t.after(() => db.close()); await initializeConsole(db.pool);
  const port = await consolePort(); const origin = `http://localhost:${port}`;
  const auth = new ConsoleAuth(db.pool,origin); const secret = await auth.admin('create','Console admin');
  const running = await startConsole({auth,countries:new CountryReadiness({ES:'https://es.example.test'},async () => new Response('{"status":"ready"}')),
    rateKey:randomBytes(32).toString('hex'),port,assets:await loadConsoleAssets(new URL('../dist',import.meta.url).pathname)});
  t.after(() => running.close()); const browser = await chromium.launch({headless:true}); t.after(() => browser.close());
  const context = await browser.newContext(); const page = await context.newPage();
  const authenticator = await addVirtualAuthenticator(context,page); t.after(() => authenticator.close());
  async function visuals(screen: string) {
    if (!process.env.CONSOLE_VISUAL_DIR) return;
    for (const language of ['en','es']) for (const theme of ['light','dark'] as const) for (const width of [390,1280]) {
      await page.getByRole('combobox').selectOption(language); await page.emulateMedia({colorScheme:theme}); await page.setViewportSize({width,height:900});
      await page.screenshot({path:`${process.env.CONSOLE_VISUAL_DIR}/${screen}-${language}-${theme}-${width}.png`,fullPage:true});
    }
    await page.getByRole('combobox').selectOption('en');
  }
  await page.goto(origin); assert.equal(await page.getByRole('heading',{name:'Admin sign-in',exact:true}).count(),1);
  await visuals("signin");
  await page.getByLabel('Enrolment secret',{exact:true}).fill(secret!);
  await page.getByLabel('Enrolment secret',{exact:true}).press('Enter');
  await page.getByRole('heading',{name:'Country readiness',exact:true}).waitFor({timeout:5000});
  assert.match(await page.locator('main').innerText(),/Spain[\s\S]*Ready/);
  await visuals("health");
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('heading',{name:'Admin sign-in',exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign in with passkey',exact:true}).click();
  await page.getByRole('heading',{name:'Country readiness',exact:true}).waitFor({timeout:5000});
  assert.equal((await db.pool.query('SELECT count(*) FROM console_passkeys')).rows[0].count,'1');
  await page.reload(); await page.getByRole('heading',{name:'Country readiness',exact:true}).waitFor({timeout:5000});
});
