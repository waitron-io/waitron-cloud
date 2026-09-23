import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPortalFixture } from './fixtures.ts';
test('passive reads do not renew; real activity is throttled and late activity cannot undo logout', async () => {
  const f = await startPortalFixture();
  try {
    const page = await f.browser.newPage(); page.setDefaultTimeout(3000);
    await page.clock.install({time: new Date('2030-01-01T12:00:00Z')});
    let reads=0, activities=0; let release: (() => void) | undefined;
    await page.route('**/api/account/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/logout')) { await route.fulfill({status:204}); return; }
      if (path.endsWith('/activity')) { activities++; await new Promise<void>(resolve => {release=resolve;}); }
      else reads++;
      await route.fulfill({json:{accountId:'owner',expiresAt:'2030-01-01T12:30:00Z'}});
    });
    await page.goto(`${f.origin}/account`);
    await page.getByText('You are signed in to Waitron Cloud.').waitFor();
    assert.equal(reads,1); assert.equal(activities,0);
    await page.clock.runFor(61_000); assert.equal(activities,0);
    await Promise.all([page.waitForRequest('**/session/activity'), page.keyboard.press('Tab')]);
    assert.equal(activities,1);
    await page.keyboard.press('Tab'); assert.equal(activities,1);
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
    release?.();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.ok(await page.getByRole('heading',{name:'Sign in',exact:true}).isVisible());
  } finally { await f.close(); }
});

test('expiry and visibility rechecks do not renew, and 401 fences a delayed activity response', async () => {
  const f=await startPortalFixture();
  try {
    const page=await f.browser.newPage();page.setDefaultTimeout(3000);await page.clock.install({time:new Date('2030-01-01T12:00:00Z')});
    let reads=0,activity=0;let release:(()=>void)|undefined;
    await page.route('**/api/account/**',async route=>{
      if(route.request().url().endsWith('/activity')) {activity++;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{accountId:'old',expiresAt:'2030-01-01T12:30:00Z'}});return;}
      reads++;await route.fulfill(reads===1?{json:{accountId:'old',expiresAt:'2030-01-01T12:00:10Z'}}:{status:401,json:{error:'unauthenticated'}});
    });
    await page.goto(`${f.origin}/account`);await page.getByText('You are signed in to Waitron Cloud.').waitFor();
    await Promise.all([page.waitForRequest('**/session/activity'),page.keyboard.press('Tab')]);
    await page.clock.runFor(11_000);await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
    assert.equal(reads,2);assert.equal(activity,1);release?.();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    await page.route('**/api/account/session',route=>route.fulfill({status:503,json:{error:'temporarily_unavailable'}}));
    await page.getByRole('link',{name:'Waitron Cloud',exact:true}).click();
    await page.getByText('We could not check your session. Try again.').waitFor();
    assert.equal(await page.getByText('You are signed in to Waitron Cloud.').count(),0);
  } finally {await f.close();}
});
