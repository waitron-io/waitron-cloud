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
    assert.ok(await page.locator('wt-form-error-summary').getByText('Use at least 15 characters.').isVisible());
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
      if (password.length === 513) assert.ok(await page.locator('wt-form-error-summary').getByText('This password is too long. Use fewer characters.').isVisible());
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

test('compromised password responses identify the password field in both languages', async () => {
  const f=await startPortalFixture();
  try {
    for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const){
      const page=await f.browser.newPage({locale,colorScheme,viewport:{width:390,height:812}});page.setDefaultTimeout(3000);
      try {
        const copy=locale==='en'?'This password is known to be compromised. Choose a different password.':'Esta contraseña está comprometida. Elige una contraseña diferente.';
        await page.route('**/api/account/signup/complete',route=>route.fulfill({status:400,json:{error:'password_compromised'}}));
        await page.goto(`${f.origin}/signup#token=${'a'.repeat(43)}&lang=${locale}`);
        await page.getByLabel(locale==='en'?'Legal business name':'Nombre legal del negocio').fill('Café Sol');
        await page.locator('input[name=password]').fill('a compromised café password');
        await page.getByRole('button',{name:locale==='en'?'Create account':'Crear cuenta',exact:true}).click();
        await page.locator('wt-form-error-summary').getByText(copy,{exact:true}).waitFor();
        assert.equal(await page.locator('input[name=password]').getAttribute('aria-invalid'),'true');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:new URL(`../dist/password-compromised-${locale}-${colorScheme}-phone.png`,import.meta.url).pathname,fullPage:true});
        await page.setViewportSize({width:1280,height:900});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:new URL(`../dist/password-compromised-${locale}-${colorScheme}-desktop.png`,import.meta.url).pathname,fullPage:true});
      } finally {await page.close();}
    }
  } finally {await f.close();}
});

test('a confirmed screening outage tells both languages to retry instead of claiming an uncertain write', async () => {
  const f=await startPortalFixture();
  try {
    for(const locale of ['en','es'] as const){
      const page=await f.browser.newPage({locale});page.setDefaultTimeout(3000);
      try {
        await page.route('**/api/account/password-reset/complete',route=>route.fulfill({status:503,headers:{'Retry-After':'1'},json:{error:'temporarily_unavailable'}}));
        await page.goto(`${f.origin}/reset-password#token=${'a'.repeat(43)}&lang=${locale}`);
        await page.locator('input[name=password]').fill('an acceptable café password');
        await page.getByRole('button',{name:locale==='en'?'Save new password':'Guardar nueva contraseña',exact:true}).click();
        await page.getByText(locale==='en'?'This service is temporarily unavailable. Try again.':'El servicio no está disponible temporalmente. Vuelve a intentarlo.',{exact:true}).waitFor();
        assert.equal(await page.getByText(locale==='en'?'We could not confirm the result. You can try signing in with the password you chose, or deliberately retry this form.':'No hemos podido confirmar el resultado. Puedes intentar iniciar sesión con la contraseña que has elegido o volver a enviar este formulario.',{exact:true}).count(),0);
      } finally {await page.close();}
    }
  } finally {await f.close();}
});
