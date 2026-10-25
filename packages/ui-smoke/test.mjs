import './translation-grading.test.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateCosts } from '../../scripts/cloud-cost/calculator.mjs';

const root = import.meta.dirname;
test('the pinned registry package renders and responds in a real browser', { timeout: 60000 }, async () => {
  const consumer = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(consumer.dependencies['@waitron-io/ui-core'], '0.1.0', 'consumer must pin the registry version');
  const manifestPath = join(dirname(fileURLToPath(import.meta.resolve('@waitron-io/ui-core'))), '../package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.name, '@waitron-io/ui-core');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.waitronSource.commit, '0a93f4d3557b669661ac8f589aad866e2cd9653f');
  assert((await realpath(manifestPath)).includes('/node_modules/.pnpm/'), 'must use an installed package');
  const output = await build({ absWorkingDir: root, entryPoints: ['src/fixture.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, metafile: true });
  assert(Object.keys(output.metafile.inputs).some(path => path.includes('@waitron-io/ui-core/dist/')));
  assert(!Object.keys(output.metafile.inputs).some(path => path.includes('/packages/ui-core/src/')));
  let browser;
  const server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(output.outputFiles[0].contents);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cloud package check</title></head><body data-theme="light"><script type="module" src="/fixture.js"></script></body></html>');
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('body[data-ready="true"]');
    const input = page.locator('#email input');
    await input.fill('owner@venue.example');
    assert.equal(await input.inputValue(), 'owner@venue.example');
    assert.equal(await input.getAttribute('name'), 'email');
    assert.equal(await input.getAttribute('autocomplete'), 'email');
    await page.locator('#continue button').click();
    assert.equal(await page.locator('output').textContent(), '1');
    const colours = [];
    for (const theme of ['light', 'dark']) {
      colours.push(await page.evaluate(theme => { document.body.dataset.theme = theme; return getComputedStyle(document.body).backgroundColor; }, theme));
    }
    assert.notEqual(colours[0], colours[1]);
    assert(!colours.includes('rgba(0, 0, 0, 0)'));
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test('the offline cost calculator keeps unknowns visible in both languages, themes and widths', { timeout: 120000 }, async () => {
  let browser;
  try {
    browser = await chromium.launch();
    for (const language of ['en', 'es']) for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width, height: 900 } });
      try {
        const page = await context.newPage(), outside = [], errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.route('**/*', route => {
          if (route.request().url().startsWith('file:')) return route.continue();
          outside.push(route.request().url()); return route.abort();
        });
        await page.goto(new URL('../../docs/cloud-cost-calculator.html', import.meta.url).href);
        await page.locator('#language').selectOption(language);
        await page.locator('#theme').selectOption(theme);
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        assert.equal(await page.locator('body').getAttribute('data-ready'), 'true');
        assert.match(await page.locator('h1').innerText(), language === 'es' ? /costar Cloud/ : /Cloud could cost/);
        assert.match(await page.locator('#status').innerText(), language === 'es' ? /incomplet/ : /Incomplete/);
        assert.equal(await page.locator('#sessionsPerMonth').inputValue(), '');
        assert.equal(await page.locator('[data-venues]').count(), 5);
        const initial = await page.evaluate(() => ({ data: JSON.parse(document.querySelector('#cost-data').textContent),
          controls: window.cloudCostControls, result: window.cloudCostResult,
          overflow: document.documentElement.scrollWidth > innerWidth,
          background: getComputedStyle(document.body).backgroundColor }));
        assert.equal(initial.overflow, false); assert.notEqual(initial.background, 'rgba(0, 0, 0, 0)');
        assert.deepEqual(initial.result, calculateCosts({ data: initial.data, controls: initial.controls }));
        assert.equal(initial.result.scenarios.base.rows[0].averageSubtotal, null);
        assert.equal(initial.result.scenarios.base.rows[1].total, null);
        assert.equal(await page.locator('[data-evidence-source]').count(), 3);
        await page.locator('#breakdown').evaluate(element => { element.open = true; });
        assert.equal(await page.locator('[data-line-id]').count(), 16);
        assert.match(await page.locator('[data-line-id="internet-transfer"]').innerText(), language === 'es' ? /Desconocido/ : /Unknown/);
        await page.locator('#breakdown').evaluate(element => { element.open = false; });
        await page.locator('#advanced').evaluate(element => { element.open = true; });
        await page.locator('#capacity').fill('10'); await page.locator('#databaseCapacity').fill('100');
        await page.locator('#sessionsPerMonth').fill('3');
        await page.locator('#region').selectOption('eu-north-1');
        const changed = await page.evaluate(() => ({ controls: window.cloudCostControls, result: window.cloudCostResult }));
        assert.deepEqual(changed.result, calculateCosts({ data: initial.data, controls: changed.controls }));
        assert.equal(changed.result.scenarios.base.rows[2].capacity.cells, 1);
        assert.equal(changed.result.scenarios.base.rows[3].capacity.cells, 10);
        assert.equal(changed.result.scenarios.base.sessionBytesPerVenue, 8510904);
        const mature = changed.result.scenarios.base.archive.matureByteSeconds;
        await page.locator('#retentionMonths').fill('2');
        assert.ok(await page.evaluate(value => window.cloudCostResult.scenarios.base.archive.matureByteSeconds < value, mature));
        await page.locator('#ordersPerDay').fill('0');
        assert.ok(await page.evaluate(() => window.cloudCostResult.scenarios.base.rows[1].lines.find(row => row.id === 'stream-write-list').quantity > 0));
        for (const value of ['', '-1', '1.5']) {
          await page.locator('#ordersPerDay').fill(value);
          if (value === '') assert.ok(await page.evaluate(() => window.cloudCostResult.scenarios.base.rows[1].gaps.includes('ordersPerDay:unknown')));
          else { assert.equal(await page.evaluate(() => window.cloudCostResult), null); assert.ok(await page.locator('[role="alert"]').isVisible()); }
        }
        await page.locator('#ordersPerDay').fill('207'); await page.locator('#retentionMonths').fill('12');
        await page.locator('#advanced').evaluate(element => { element.open = false; });
        await page.locator('#ordersPerDay').focus(); await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'retentionMonths');
        assert.equal(await page.locator('#ordersPerDay').getAttribute('aria-label'), null);
        assert.ok(await page.getByLabel(language === 'es' ? 'Pedidos por día' : 'Orders per day', { exact: true }).count());
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (process.env.CLOUD_COST_SCREENSHOTS) await page.screenshot({ path: join(process.env.CLOUD_COST_SCREENSHOTS, `${language}-${theme}-${width}.png`), fullPage: true });
        assert.deepEqual(outside, []); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); }
});


test('the unavailable page stays readable and retryable in both languages, themes and widths', {timeout:60000}, async()=>{
 const {createPublicGate}=await import('../remote-access/src/public-gate.ts');
 const {randomBytes,createHash}=await import('node:crypto');
 const gate=createPublicGate({key:randomBytes(32),difficulty:8,routes:()=>[{publicHostname:'public.example.test',staffHostname:'staff.example.test',address:'127.0.0.1',port:1}]});
 const server=createServer((req,res)=>{req.headers.host='public.example.test';req.headers['x-waitron-sni']='public.example.test';req.headers['x-waitron-client-ip']='192.0.2.2';gate.handle(req,res);});
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const challenge=await(await fetch(url+'/_cloud/challenge')).json();
  let nonce=0;while(createHash('sha256').update(`${challenge.challenge}:${nonce}`).digest().readUInt32BE(0)>=2**(32-challenge.difficulty))nonce++;
  const answer=await fetch(url+'/_cloud/solve',{method:'POST',body:JSON.stringify({challenge:challenge.challenge,nonce})});
  assert.equal(answer.status,204);
  browser=await chromium.launch();
  for(const language of ['en','es'])for(const theme of ['light','dark'])for(const width of [390,1280]){
   const context=await browser.newContext({locale:language,colorScheme:theme,viewport:{width,height:800},extraHTTPHeaders:{cookie:answer.headers.get('set-cookie').split(';')[0]}});
   try{
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const response=await page.goto(url+'/public/availability');assert.equal(response.status(),503);
    assert.equal(await page.locator('html').getAttribute('lang'),language);
    assert.match(await page.locator('h1').innerText(),language==='es'?/^Local no disponible$/:/^Venue unavailable$/);
    const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,background:getComputedStyle(document.body).backgroundColor,main:document.querySelector('main').getBoundingClientRect().toJSON()}));
    assert.equal(layout.overflow,false);assert.equal(layout.background,theme==='light'?'rgb(247, 248, 250)':'rgb(17, 24, 39)');assert(layout.main.width<=width);
    if(process.env.CLOUD_UNAVAILABLE_SCREENSHOTS)await page.screenshot({path:join(process.env.CLOUD_UNAVAILABLE_SCREENSHOTS,`${language}-${theme}-${width}.png`),fullPage:true});
    await Promise.all([page.waitForResponse(response=>response.url()===url+'/public/availability'&&response.status()===503),page.getByRole('link',{name:language==='es'?'Volver a intentar':'Try again',exact:true}).click()]);
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
  assert.equal(gate.stats().active,0);assert.equal(gate.stats().unavailable,16);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
