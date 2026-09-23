import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPortalFixture } from './fixtures.ts';
test('the real build renders shared controls under the account server CSP', async () => {
  const fixture = await startPortalFixture();
  try {
    const page = await fixture.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error' && !(msg.location().url.endsWith('/api/account/session') && msg.text().includes('401'))) errors.push(msg.text()); });
    await page.goto(`${fixture.origin}/login`);
    await page.locator('wt-card').waitFor();
    assert.ok(await page.locator('h1').isVisible());
    assert.notEqual(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.deepEqual(errors, []);
  } finally { await fixture.close(); }
});
