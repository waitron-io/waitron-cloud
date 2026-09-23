import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPortalFixture } from './fixtures.ts';
test('Spanish signup preserves values through switching language and validates before sending', async () => {
  const f = await startPortalFixture();
  try {
    const page = await f.browser.newPage({locale: 'es-ES'});
    page.setDefaultTimeout(3000);
    await page.goto(`${f.origin}/signup#token=${'a'.repeat(43)}&lang=es`);
    await page.getByRole('heading', {name: 'Completa tu cuenta'}).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    await page.getByLabel('Nombre legal del negocio').fill('Café Sol');
    await page.getByLabel('Nueva contraseña').fill('short');
    await page.getByLabel('Idioma').selectOption('en');
    assert.equal(await page.getByLabel('Legal business name').inputValue(), 'Café Sol');
    assert.equal(await page.getByLabel('New password').inputValue(), 'short');
    await page.getByRole('button', {name: 'Create account', exact: true}).click();
    assert.equal(await page.locator('input[name=password]').getAttribute('aria-invalid'),'true');
    assert.ok(await page.locator('wt-form-error-summary').getByText('Use at least 15 characters and at most 1024 UTF-8 bytes.').isVisible());
    const requests: Record<string, string>[] = [];
    await page.route('**/api/account/signup/complete', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({status: 201, json: {accountId:'account',organisationId:'org',legalBusinessId:'business'}});
    });
    await page.getByLabel('New password').fill('🔑'.repeat(15));
    await page.getByLabel('New password').press('Enter');
    await page.getByText('Your account is ready. Sign in to continue.').waitFor();
    assert.deepEqual(requests, [{token:'a'.repeat(43),password:'🔑'.repeat(15),organisationName:'Café Sol',legalBusinessName:'Café Sol',countryCode:'ES'}]);
  } finally { await f.close(); }
});

test('password limits count Unicode and UTF-8 independently; optional organisation is explicit', async () => {
  const f=await startPortalFixture();
  try {
    const page=await f.browser.newPage();page.setDefaultTimeout(3000);
    const bodies:Record<string,string>[]=[];
    await page.route('**/signup/complete',async route=>{bodies.push(route.request().postDataJSON());await route.fulfill({status:400,json:{error:'link_unavailable'}});});
    await page.goto(`${f.origin}/signup#token=${'a'.repeat(43)}`);
    await page.getByLabel('Legal business name').fill('Café Sol');
    for (const password of ['🔑'.repeat(14),'é'.repeat(513)]) {
      await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();
      assert.equal(await page.locator('input[name=password]').getAttribute('aria-invalid'),'true');assert.equal(bodies.length,0);
    }
    await page.getByLabel('Use a different organisation name').check();
    await page.locator('input[name=organisationName]').fill('Venue Group');
    await page.locator('input[name=password]').fill('é'.repeat(512));
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await page.getByText(/This link is unavailable/).waitFor();
    assert.equal(bodies.length,1);assert.equal(bodies[0]!.password,'é'.repeat(512));assert.equal(bodies[0]!.organisationName,'Venue Group');
    await page.goto(`${f.origin}/login`);
    await page.route('**/login',async route=>{bodies.push(route.request().postDataJSON());await route.fulfill({status:401,json:{error:'credentials_invalid'}});});
    await page.getByLabel('Email').fill('owner@example.test');await page.locator('input[name=password]').fill('short');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByText('The email or password is incorrect.').waitFor();
    assert.equal(bodies.at(-1)!.password,'short');
  } finally {await f.close();}
});
