import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser} from 'playwright';
import {loadPortalAssets, portalResponse} from '../../../packages/account-http/src/portal.ts';

const assets = await loadPortalAssets(new URL('../dist', import.meta.url).pathname);
const origin = 'https://portal.test';
let browser: Browser;
before(async () => { browser = await chromium.launch({headless: true}); });
after(async () => { await browser?.close(); });

async function account(t: TestContext, billingTrialAvailable = true, enrollmentRequired = false, installations: unknown[] = []) {
  const page = await browser.newPage({locale: 'en'});
  t.after(() => page.close());
  page.setDefaultTimeout(3500);
  let signedIn = true;
  const session = {accountId: 'owner', expiresAt: '2099-01-01T00:00:00Z',
    ...(billingTrialAvailable ? {billingTrialAvailable: true} : {}), ...(enrollmentRequired ? {enrollmentRequired: true} : {})};
  const calls: string[] = [];
  await page.route(origin + '/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/account/')) {
      const response = portalResponse(new Request(route.request().url()), assets);
      await route.fulfill({status: response.status, headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer())});
      return;
    }
    const endpoint = path.slice('/api/account'.length);
    calls.push(endpoint);
    if (endpoint === '/session' || endpoint === '/session/activity') {
      return signedIn ? route.fulfill({json: session}) : route.fulfill({status: 401, json: {error: 'session_expired'}});
    }
    if (endpoint === '/logout') { signedIn = false; return route.fulfill({status: 204}); }
    const data: Record<string, unknown> = {
      '/sessions': {sessions: []},
      '/installations': {installations},
      '/passkeys': {passkeys: []},
      '/authenticator': {active: false, version: 0, recoveryCodesRemaining: 0, available: false},
      '/alerts': {enabled: false, locale: 'en'},
      '/translation-consent': {consents: []},
      '/billing/read': {venues: []},
    };
    return endpoint in data ? route.fulfill({json: data[endpoint]})
      : route.fulfill({status: 503, json: {error: 'temporarily_unavailable'}});
  });
  return {page, calls, expire() { signedIn = false; }, switchAccount() { session.accountId = 'second-owner'; }};
}

test('the account navigation opens distinct pages and restores the selection on Back and reload', async t => {
  const {page, calls} = await account(t);
  await page.goto(origin + '/account');
  const nav = page.getByRole('navigation', {name: 'Cloud account'});
  const current = nav.locator('a[aria-current="page"]');
  await current.waitFor();
  assert.equal(await current.textContent(), 'Account');
  assert.equal(await page.getByRole('heading', {name: 'Your venues', exact: true}).count(), 0);
  assert.equal(await page.getByRole('heading', {name: 'Connected trial', exact: true}).count(), 0);
  assert.ok(!calls.includes('/installations') && !calls.includes('/billing/read'), calls.join(', '));

  await nav.getByRole('link', {name: 'Venues', exact: true}).click();
  await page.waitForURL(origin + '/account/venues');
  const heading = page.getByRole('heading', {level: 1, name: 'Venues', exact: true});
  assert.equal(await heading.evaluate(element => document.activeElement === element), true);
  await page.getByRole('heading', {name: 'Your venues', exact: true}).waitFor();
  assert.equal(await page.getByRole('heading', {name: 'Account security', exact: true}).count(), 0);
  assert.ok(!calls.includes('/billing/read'), calls.join(', '));
  const historyLength = await page.evaluate(() => history.length);
  await nav.getByRole('link', {name: 'Venues', exact: true}).click();
  assert.equal(await page.evaluate(() => history.length), historyLength);

  await nav.getByRole('link', {name: 'Remote access', exact: true}).click();
  await page.waitForURL(origin + '/account/remote-access');
  await page.getByRole('heading', {level: 1, name: 'Remote access', exact: true}).waitFor();
  assert.equal(await current.textContent(), 'Remote access');
  assert.equal(await page.getByRole('heading', {name: 'Connected trial', exact: true}).count(), 0);
  await page.goBack();
  await page.waitForURL(origin + '/account/venues');
  assert.equal(await current.textContent(), 'Venues');
  await page.reload();
  await heading.waitFor();
  assert.equal(await current.textContent(), 'Venues');

  await nav.getByRole('link', {name: 'Billing', exact: true}).click();
  await page.waitForURL(origin + '/account/billing');
  await page.getByRole('heading', {name: 'Connected trial', exact: true}).waitFor();
  assert.equal(await current.textContent(), 'Billing');
});

test('secondary account controls start collapsed and remain available', async t => {
  const {page} = await account(t);
  await page.goto(origin + '/account');
  const security = page.getByRole('region', {name: 'Account security', exact: true});
  await security.waitFor();
  const credentials = security.getByLabel('New password', {exact: true});
  const sessions = security.getByText('A session ends after 30 minutes without activity or after 12 hours, whichever comes first.', {exact: true});
  assert.equal(await credentials.isVisible(), false);
  assert.equal(await sessions.isVisible(), false);
  await page.getByRole('button', {name: 'Sign out', exact: true}).waitFor();
  await security.locator('summary').filter({hasText: 'Password and email'}).click();
  await credentials.waitFor();
  await security.locator('summary').filter({hasText: 'Active sessions'}).click();
  await sessions.waitFor();
});

test('venue cards sort by signed name and disclose secondary status', async t => {
  const first='11111111-1111-4111-8111-111111111111';
  const installation=(digit:string,venueName?:string)=>{
    const id=first.replaceAll('1',digit);
    return {installationId:id,venueId:id,organisationId:first,legalBusinessId:first,environment:'test',revision:0,
      revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
      overview:{organisationName:'Cloud Company',businessName:'Cloud Company SL',countryCode:'ES',
        latestSnapshotAt:null,verifiedSnapshotAt:null,...(venueName ? {venueName} : {})},
      services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({
        service,state:'unconfigured',health:'unknown',failure:null,observedAt:null
      }))};
  };
  const {page}=await account(t,true,false,[installation('2','Zest Café'),installation('3'),installation('4','Alba Bakery')]);
  await page.goto(origin+'/account/venues');
  const titles=page.locator('article.installation').getByRole('heading',{level:3});
  await titles.first().waitFor();
  assert.deepEqual(await titles.allTextContents(),['Alba Bakery','Venue · 33333333','Zest Café']);
  const venue=page.locator('article.installation').first();
  const detail=venue.getByText('No verified snapshot yet',{exact:true});
  const translation=venue.getByText('Menu translation',{exact:true});
  const alerts=page.getByRole('region',{name:'Service alerts',exact:true});
  assert.equal(await alerts.evaluate(element=>Boolean(document.querySelector('article.installation')!
    .compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  assert.equal(await detail.isVisible(),false);
  assert.equal(await translation.isVisible(),false);
  await venue.locator('summary').filter({hasText:'Details'}).click();
  await detail.waitFor();
  await venue.getByText('Cloud Company SL',{exact:true}).waitFor();
  await translation.waitFor();
});

test('direct Billing hides the link and returns to Account when Billing is unavailable', async t => {
  const {page, calls} = await account(t, false);
  assert.equal((await page.goto(origin + '/account/billing'))?.status(), 200);
  await page.waitForURL(origin + '/account');
  const nav = page.getByRole('navigation', {name: 'Cloud account'});
  await nav.waitFor();
  assert.equal(await nav.getByRole('link', {name: 'Billing', exact: true}).count(), 0);
  assert.ok(!calls.includes('/billing/read'), calls.join(', '));
});

test('a direct account subpage keeps required enrollment ahead of the navigation', async t => {
  const {page, calls} = await account(t, true, true);
  assert.equal((await page.goto(origin + '/account/venues'))?.status(), 200);
  await page.getByRole('heading', {name: 'Account security', exact: true}).waitFor();
  assert.equal(await page.getByRole('navigation', {name: 'Cloud account'}).count(), 0);
  assert.ok(!calls.includes('/installations'), calls.join(', '));
});

test('the Venues page counts session activity and returns an expired session to sign-in', async t => {
  const {page, expire} = await account(t);
  await page.goto(origin + '/account/venues');
  await page.getByRole('navigation', {name: 'Cloud account'}).waitFor();
  const activity = page.waitForResponse('**/api/account/session/activity');
  expire();
  await page.keyboard.press('Tab');
  assert.equal((await activity).status(), 401);
  await page.waitForURL(origin + '/login');
  assert.equal(await page.getByRole('navigation', {name: 'Cloud account'}).count(), 0);
});

test('a person can sign out from Venues', async t => {
  const {page} = await account(t);
  await page.goto(origin + '/account/venues');
  await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await page.waitForURL(origin + '/login');
  assert.equal(await page.getByRole('navigation', {name: 'Cloud account'}).count(), 0);
});

test('opening Billing again retries a read interrupted by leaving the page', async t => {
  const {page} = await account(t);
  let release!: () => void;
  const firstReply = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route('**/api/account/billing/read', async route => {
    if (++reads === 1) await firstReply;
    await route.fulfill({json: {venues: []}});
  });
  try {
    const firstRead = page.waitForRequest('**/api/account/billing/read');
    await page.goto(origin + '/account/billing');
    await firstRead;
    const nav = page.getByRole('navigation', {name: 'Cloud account'});
    await nav.getByRole('link', {name: 'Account', exact: true}).click();
    const secondRead = page.waitForResponse('**/api/account/billing/read');
    await nav.getByRole('link', {name: 'Billing', exact: true}).click();
    assert.equal((await secondRead).status(), 200);
    await page.getByRole('heading', {name: 'Connected trial', exact: true}).waitFor();
    assert.equal(reads, 2);
  } finally {
    release();
  }
});

test('Billing offers a retry after the read wait when a different account signs in', async t => {
  const {page, switchAccount} = await account(t);
  let reads = 0;
  await page.clock.install();
  await page.route('**/api/account/billing/read', route => ++reads === 1
    ? route.fulfill({status: 429, headers: {'retry-after': '20'}, json: {error: 'rate_limited'}})
    : route.fulfill({json: {venues: []}}));
  await page.goto(origin + '/account/billing');
  await page.getByRole('alert').filter({hasText: /Too many requests/}).waitFor();
  switchAccount();
  const activity = page.waitForResponse('**/api/account/session/activity');
  await page.keyboard.press('Tab');
  assert.equal((await activity).status(), 200);
  const retry = page.getByRole('button', {name: 'Try again', exact: true});
  await retry.waitFor();
  assert.equal(await retry.isDisabled(), true);
  await page.clock.runFor(21_000);
  assert.equal(await retry.isEnabled({timeout: 1000}), true);
  assert.equal(reads, 1);
  await retry.click();
  await page.getByRole('heading', {name: 'Connected trial', exact: true}).waitFor();
  assert.equal(reads, 2);
});
