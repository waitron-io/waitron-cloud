import { setTimeout as delay } from 'node:timers/promises';
import { openRemoteMeasurement } from './remote.mjs';

const fail = () => { throw Error('Invalid cloud cost browser journey'); };
const need = value => { if (!value) fail(); };

// The generated browser visits the built dashboard. API-only samples cannot supply
// asset or background traffic, and neither sample establishes a monthly frequency.
export async function measureRemoteBrowser(options) {
  let chromium, staffHostname, email, password;
  let browser, meter, step, phase = 'options';
  let reconnectSession = 'unseen', reconnectPage = 'clear';
  try {
    const keys = ['chromium', 'staffHostname', 'email', 'password'];
    need(options && Object.getPrototypeOf(options) === Object.prototype
      && Reflect.ownKeys(options).length === keys.length
      && Reflect.ownKeys(options).every(key => keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value')));
    ({ chromium, staffHostname, email, password } = options);
    need(chromium && typeof chromium.launch === 'function'
      && typeof staffHostname === 'string' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(staffHostname)
      && typeof email === 'string' && email.length > 0 && typeof password === 'string' && password.length > 0);
    phase = 'meter';
    meter = await openRemoteMeasurement({ target: 'tcp://127.0.0.1:443', audience: 'staff' });
    phase = 'launch';
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-networking',
      '--host-resolver-rules=MAP ' + staffHostname + ' 127.0.0.1:' + meter.port + ',MAP * ~NOTFOUND'] });
    phase = 'context';
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-GB', viewport: { width: 1280, height: 900 } });
    const result = { kind: 'pinned-waitron-browser-gateway', costMeasured: false, actions: [],
      requests: { document: 0, script: 0, stylesheet: 0, image: 0, font: 0, api: 0, eventsource: 0, other: 0 },
      completedRequestBodyBytes: 0, completedResponseBodyBytes: 0, completedRequests: 0, interruptedStreamRequests: 0,
      unfinishedStreamRequests: 0, streamBodyBytes: null, bodyBytesCoverage: 'completed-requests-only',
      failedRequests: 0, unexpectedResponses: 0, pageErrors: 0, outsideRequests: 0, cachedRequests: 0 };
    const pending = [], seen = new Set();
    const group = req => req.resourceType() === 'eventsource' ? 'eventsource'
      : new URL(req.url()).pathname.startsWith('/management-api/') ? 'api'
      : Object.hasOwn(result.requests, req.resourceType()) ? req.resourceType() : 'other';
    // Routing interception disables Chromium's HTTP cache. Isolation is enforced
    // by the internal network and DNS rules; observation leaves the cache intact.
    context.on('request', req => {
      if (new URL(req.url()).origin !== 'https://' + staffHostname) result.outsideRequests++;
      seen.add(req); result.requests[group(req)]++;
    });
    context.on('response', res => {
      if (phase === 'reconnect' && new URL(res.url()).pathname === '/management-api/session/me')
        reconnectSession = res.status() === 200 ? 'accepted' : res.status() === 401 ? 'refused' : 'other';
      if (res.status() >= 400 && !(res.status() === 401 && new URL(res.url()).pathname === '/management-api/session/me'))
        result.unexpectedResponses++;
    });
    context.on('requestfinished', req => {
      seen.delete(req);
      pending.push(req.sizes().then(size => {
        result.completedRequests++; result.completedRequestBodyBytes += size.requestBodySize; result.completedResponseBodyBytes += size.responseBodySize;
      }).catch(() => { result.failedRequests++; }));
    });
    context.on('requestfailed', req => {
      seen.delete(req);
      if (group(req) === 'eventsource' && req.failure()?.errorText === 'net::ERR_ABORTED') result.interruptedStreamRequests++;
      else result.failedRequests++;
    });
    const drain = async (streamsRemain = false) => {
      const deadline = Date.now() + 3000;
      while ([...seen].some(req => !streamsRemain || group(req) !== 'eventsource')) {
        need(Date.now() < deadline); await delay(10);
      }
      await Promise.all(pending);
    };
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    const cached = new Set(); cdp.on('Network.requestServedFromCache', ({requestId}) => { cached.add(requestId); result.cachedRequests = cached.size; });
    page.on('pageerror', () => {
      result.pageErrors++;
      if (phase === 'reconnect') reconnectPage = 'error';
    });
    phase = 'login';
    await page.goto('https://' + staffHostname + '/manage/');
    const login = page.locator('dashboard-login-screen');
    await login.locator('wt-input[name=email] input').fill(email);
    result.actions.push('login-page');
    await login.locator('[data-test=continue]').click();
    await login.locator('wt-input[name=password] input').fill(password);
    await login.locator('[data-test=submit]').click();
    const skip = login.locator('[data-test=skip-passkey]');
    await skip.or(page.locator('[data-test=account-menu]')).first().waitFor();
    if (await skip.isVisible()) await skip.click();
    await page.locator('[data-test=account-menu]').waitFor(); result.actions.push('sign-in');
    phase = 'dashboard';
    await page.locator('dashboard-overview-screen [data-test=takings]').waitFor();
    await page.locator('dashboard-overview-screen [data-test=overdue-empty]').waitFor();
    await drain(true); result.actions.push('dashboard-read');
    // A reload opens the dashboard from its real session cookie and browser cache.
    phase = 'reconnect';
    step = 'reload';
    await page.reload();
    step = 'takings';
    await page.locator('dashboard-overview-screen [data-test=takings]').waitFor();
    step = 'overdue-empty';
    await page.locator('dashboard-overview-screen [data-test=overdue-empty]').waitFor();
    step = 'requests';
    await drain(true);
    result.actions.push('browser-reconnect');
    phase = 'logout';
    await page.locator('[data-test=account-menu] button').first().click();
    await page.locator('[data-test=logout]').click();
    await login.locator('wt-input[name=email] input').waitFor(); result.actions.push('sign-out');
    await drain(true); await page.goto('about:blank'); await drain(true);
    phase = 'close';
    await context.close(); await browser.close(); browser = undefined;
    await Promise.all(pending);
    result.unfinishedStreamRequests = seen.size;
    phase = 'accounting';
    need([...seen].every(req => group(req) === 'eventsource')
      && result.completedRequests + result.interruptedStreamRequests + result.unfinishedStreamRequests === Object.values(result.requests).reduce((a,b) => a+b, 0) && result.failedRequests === 0 && result.unexpectedResponses === 0
      && result.pageErrors === 0 && result.outsideRequests === 0);
    phase = 'snapshot';
    await meter.close(); result.snapshot = meter.snapshot();
    need(result.snapshot.producer.bytesFromGateway > result.completedResponseBodyBytes && result.completedResponseBodyBytes > 0);
    return result;
  } catch (cause) {
    const error = Error('Invalid cloud cost browser journey');
    Object.defineProperty(error, 'browserPhase', { value: phase });
    if (phase === 'reconnect') {
      // Only fixed observations cross the generated child boundary. Inspecting
      // an unusual thrown value must not replace the public journey refusal.
      let failure = 'other';
      try { if (Object.getOwnPropertyDescriptor(cause, 'name')?.value === 'TimeoutError') failure = 'timeout'; }
      catch {}
      Object.defineProperties(error, {
        browserStep: { value: step }, browserFailure: { value: failure },
        browserSession: { value: reconnectSession }, browserPage: { value: reconnectPage },
      });
    }
    throw error;
  }
  finally { await browser?.close().catch(() => {}); await meter?.close().catch(() => {}); }
}
