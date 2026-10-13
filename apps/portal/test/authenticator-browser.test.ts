import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import axe from 'axe-core';
import {hashSecret} from '@waitron-cloud/identity';
import {addVirtualAuthenticator,startPortalFixture,mailFor} from './fixtures.ts';
import {translations} from '../src/locale.ts';
const password='A real authenticator account password';
const keys={activeKeyId:'browser',keys:{browser:'ac'.repeat(32)}};
const rule={limit:1000,windowSeconds:60};
const policy={loginLifetimeMs:300_000,pendingLifetimeMs:300_000,challengeAttempts:10,enrolmentAttempts:10,
  loginAccount:rule,completeIp:rule,completeAccount:rule,completeChallenge:rule,manageIp:rule,manageAccount:rule};
function totp(secret:string,offset=0){const bits=[...secret].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
  const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)+offset));
  const mac=createHmac('sha1',Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2)))).update(bytes).digest();
  return ((mac.readUInt32BE(mac[19]!&15)&0x7fffffff)%1_000_000).toString().padStart(6,'0');}
// A previous-step proof can name the consumed enrolment step after rollover.
function signInCode(secret:string){return totp(secret,1);}
for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])
 test(`authenticator ${locale} ${colorScheme} ${width}: enrol, replace, reset, passkey, reuse and lost replies`,async()=>{
  const f=await startPortalFixture(undefined,undefined,{keys,policy});
  const context=await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}});const page=await context.newPage();page.setDefaultTimeout(7000);
  const virtual=await addVirtualAuthenticator(context,page);const c=translations[locale];const owner={id:randomUUID(),email:`factor-${randomUUID()}@example.test`};
  const requestOrigins=new Set<string>();page.on('request',r=>requestOrigins.add(new URL(r.url()).origin));
  const outcomes:{path:string;status:number}[]=[];page.on('response',r=>{if(r.url().includes('/api/account/'))outcomes.push({path:new URL(r.url()).pathname,status:r.status()});});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const shots=process.env.CLOUD_FACTOR_SHOTS??new URL('../dist/factor-shots',import.meta.url).pathname;await mkdir(shots,{recursive:true});
  async function look(stage:string){await page.evaluate(axe.source);const violations=await page.evaluate(async()=>(await window.axe.run(document)).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
    assert.deepEqual(violations,[],stage);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),stage);
    assert.equal(await page.locator('html').getAttribute('lang'),locale);await page.screenshot({path:`${shots}/${locale}-${colorScheme}-${width}-${stage}.png`,fullPage:true});
    const storage=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},url:location.href}));
    assert.deepEqual(Object.keys(storage.local).filter(k=>k!=='cloud.locale'),[]);assert.deepEqual(storage.session,{});assert.ok(!storage.url.includes('token=')&&!storage.url.includes('secret='));}
  async function login(pw=password){await page.locator('input[name=email]').fill(owner.email);await page.locator('input[name=password]').fill(pw);await page.getByRole('button',{name:c.login,exact:true}).click();}
  async function recovery(code:string){await page.getByLabel(c.factorProofType).selectOption('recovery');await page.locator('input[name=factorProof]').fill(code);await page.getByRole('button',{name:c.factorVerify,exact:true}).click();}
  async function authority(code?:string,pw=password){await page.locator('input[name=factorPassword]').fill(pw).catch(async error=>{throw new Error(JSON.stringify({outcomes:outcomes.slice(-12),heading:await page.locator('h1').textContent(),alerts:await page.locator('[role=alert]').allTextContents(),status:await page.locator('[role=status]').allTextContents()}),{cause:error});});if(code){await page.getByLabel(c.factorProofType).selectOption('recovery');await page.locator('input[name=factorProof]').fill(code);}}
  async function save(){await page.locator('.factor-codes').waitFor().catch(async error=>{throw new Error(JSON.stringify({outcomes:outcomes.slice(-5),heading:await page.locator('h1').textContent(),alerts:await page.locator('[role=alert]').allTextContents()}),{cause:error});});const codes=await page.locator('.factor-codes code').allTextContents();assert.equal(codes.length,10);assert.equal(new Set(codes).size,10);await look('codes');assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('h1')),true);await page.getByRole('button',{name:c.factorCodesSaved,exact:true}).click();await page.locator('.factor-codes').waitFor({state:'hidden'});assert.equal(await page.locator('.factor-codes code').count(),0);return codes;}
  try{
    await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[owner.id]);await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())',[owner.id,owner.email,await hashSecret(password)]);
    await page.goto(`${f.origin}/login#lang=${locale}`);await login();await page.getByText(c.accountIntro).waitFor();
    await page.locator('input[name=passkeyPassword]').fill(password);await page.getByRole('button',{name:c.passkeyAdd,exact:true}).click();await page.getByText(c.passkeyAdded,{exact:true}).waitFor();
    await page.getByText(c.factorOff??'Authenticator is off.',{exact:true}).waitFor();await authority();await page.getByRole('button',{name:c.factorEnable,exact:true}).click();
    await page.locator('.factor-secret').waitFor();await look('pending');assert.ok(await page.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>canvas.width>0));
    await page.getByRole('button',{name:c.factorCancel,exact:true}).click();await page.locator('.factor-secret').waitFor({state:'hidden'});assert.equal(await page.locator('.factor-secret').count(),0);
    await authority();await page.getByRole('button',{name:c.factorEnable,exact:true}).click();
    const secret=await page.locator('.factor-secret').textContent();assert.ok(secret);await authority();await page.locator('input[name=factorConfirmation]').fill(totp(secret));
    await page.getByRole('button',{name:c.factorActivate,exact:true}).click();let codes=await save();
    assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[owner.id])).rows[0].count,'0');
    await login();await page.getByText(c.factorLoginHelp,{exact:true}).waitFor();assert.equal((await context.cookies()).filter(v=>v.name==='cloud_session').length,0);await look('challenge');assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('h1')),true);await page.keyboard.press('Tab');assert.equal(await page.getByLabel(c.factorProofType).evaluate(e=>e===document.activeElement),true);
    await page.locator('input[name=factorProof]').fill(signInCode(secret));await page.getByRole('button',{name:c.factorVerify,exact:true}).click();await page.getByText(c.accountIntro).waitFor();
    await page.getByRole('button',{name:c.signout,exact:true}).click();await page.getByRole('heading',{name:c.login,exact:true}).waitFor();await login();await recovery(codes[0]!);await page.getByText(c.accountIntro).waitFor();await look('active');
    await authority(codes[1]);await page.getByRole('button',{name:c.factorReplace,exact:true}).click();const replacement=await page.locator('.factor-secret').textContent();assert.ok(replacement);
    await authority(codes[2]);await page.locator('input[name=factorConfirmation]').fill(totp(replacement));await page.getByRole('button',{name:c.factorActivate,exact:true}).click();codes=await save();
    await login();await recovery(codes[0]!);await page.getByText(c.accountIntro).waitFor();await authority(codes[1]);await page.getByRole('button',{name:c.factorRegenerate,exact:true}).click();codes=await save();
    // A consumed recovery proof cannot complete a fresh password challenge.
    await login();await recovery(codes[0]!);await page.getByText(c.accountIntro).waitFor();await page.getByRole('button',{name:c.signout,exact:true}).click();
    await login();await recovery(codes[0]!);await page.getByText(c.credentials,{exact:true}).first().waitFor();await login();await recovery(codes[1]!);await page.getByText(c.accountIntro).waitFor();
    const newPassword='A changed authenticator account password';
    await page.getByRole('link',{name:c.forgot,exact:true}).click();await page.locator('input[name=email]').fill(owner.email);await page.getByRole('button',{name:c.sendReset,exact:true}).click();await page.getByText(c.emailSent,{exact:true}).waitFor();await f.drainMail();
    const resetText=await mailFor(owner.email,locale==='en'?'Reset your Waitron Cloud password':'Restablece tu contraseña de Waitron Cloud');
    const resetUrl=resetText.match(/http:\/\/localhost:[^\s]+/)?.[0];assert.ok(resetUrl,'password reset link missing');
    await page.goto(resetUrl);await page.locator('input[name=password]').fill(newPassword);await page.getByRole('button',{name:c.savePassword,exact:true}).click();await page.getByText(c.resetReady,{exact:true}).waitFor();await page.getByRole('link',{name:c.login,exact:true}).click();
    await login(newPassword);await page.getByText(c.factorLoginHelp,{exact:true}).waitFor();await recovery(codes[2]!);await page.getByText(c.accountIntro).waitFor();
    await page.getByRole('button',{name:c.signout,exact:true}).click();await page.getByRole('button',{name:c.passkeySignIn,exact:true}).click();await page.getByText(c.accountIntro).waitFor();
    // Expire only the fixture’s minute windows to continue the long journey under unchanged budgets.
    const expiredRateKeys=['all-ip','login-ip'].map(scope=>createHmac('sha256',Buffer.from(f.db.rateKey,'hex')).update(JSON.stringify([scope,'127.0.0.1'])).digest('hex'));
    await f.db.pool.query("UPDATE account_rate_limits SET expires_at=clock_timestamp()-interval '1 second' WHERE key=ANY($1::text[])",[expiredRateKeys]);
    // Losing the committed reply never fetches old raw codes; fresh authority can regenerate them.
    f.loseAccountReply('/authenticator/regenerate');await authority(codes[3],newPassword);await page.getByRole('button',{name:c.factorRegenerate,exact:true}).click();
    await page.getByText(c.factorChangeUncertain,{exact:true}).waitFor().catch(async error=>{throw new Error(JSON.stringify({factor:(await f.db.pool.query('SELECT version FROM cloud_authenticator_factors WHERE account_id=$1',[owner.id])).rows,endedSessions:(await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[owner.id])).rows,outcomes:outcomes.slice(-8),heading:await page.locator('h1').textContent(),alerts:await page.locator('[role=alert]').allTextContents()}),{cause:error});});assert.equal(await page.locator('.factor-codes code').count(),0);
    await page.getByRole('button',{name:c.passkeySignIn,exact:true}).click();await page.getByText(c.accountIntro).waitFor();await page.getByText(c.factorOn,{exact:true}).waitFor();
    // A replacement's confirmation consumes its current code. Use a future adjacent step for fresh authority.
    const bits=[...replacement].map(ch=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5,'0')).join('');const time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)+1));const mac=createHmac('sha1',Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2)))).update(time).digest();const fresh=((mac.readUInt32BE(mac[19]!&15)&0x7fffffff)%1_000_000).toString().padStart(6,'0');
    await page.locator('input[name=factorPassword]').fill(newPassword);await page.getByLabel(c.factorProofType).selectOption('totp');await page.locator('input[name=factorProof]').fill(fresh);await page.getByRole('button',{name:c.factorRegenerate,exact:true}).click();codes=await save();
    for(const loss of ['whole','body'] as const){await login(newPassword);await page.getByText(c.factorLoginHelp,{exact:true}).waitFor();f.loseAccountReply('/login/factor',loss);await recovery(codes[loss==='whole'?0:1]!);
      if(loss==='whole'){await page.getByRole('heading',{name:c.login,exact:true}).waitFor();await login(newPassword);await recovery(codes[2]!);}await page.getByText(c.accountIntro).waitFor();if(loss==='whole')await page.getByRole('button',{name:c.signout,exact:true}).click();}
    await authority(codes[3],newPassword);await page.getByRole('button',{name:c.factorRemove,exact:true}).click();await page.getByText(c.factorRemoved,{exact:true}).waitFor();await login(newPassword);await page.getByText(c.accountIntro).waitFor();await page.getByText(c.factorOff,{exact:true}).waitFor();
    assert.deepEqual(errors,[]);assert.deepEqual([...requestOrigins],[f.origin]);
  }catch(error){
    let diagnostic:string;
    try{
    const rates=[];
    for(const scope of ['all-ip','login-ip']){
      const key=createHmac('sha256',Buffer.from(f.db.rateKey,'hex')).update(JSON.stringify([scope,'127.0.0.1'])).digest('hex');
      rates.push({scope,rows:(await f.db.pool.query('SELECT attempts,expires_at FROM account_rate_limits WHERE key=$1',[key])).rows});
    }
    diagnostic=JSON.stringify({outcomes:outcomes.slice(-24),heading:await page.locator('h1').textContent(),
      alerts:await page.locator('[role=alert]').allTextContents(),rates,
      activeSessions:(await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[owner.id])).rows[0].count,
      activeFactors:(await f.db.pool.query('SELECT count(*) FROM cloud_authenticator_factors WHERE account_id=$1',[owner.id])).rows[0].count});
    }catch{throw error;}
    throw new Error(diagnostic,{cause:error});
  }finally{await virtual.close();await context.close();await f.close();}
 });

test('first authenticator sign-in uses an unused adjacent code after enrolment rollover',async()=>{
  const f=await startPortalFixture(undefined,undefined,{keys,policy});const page=await f.browser.newPage();page.setDefaultTimeout(7000);
  const owner={id:randomUUID(),email:`rollover-${randomUUID()}@example.test`},c=translations.en;
  try{
    await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[owner.id]);
    await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())',[owner.id,owner.email,await hashSecret(password)]);
    await page.goto(`${f.origin}/login`);await page.locator('input[name=email]').fill(owner.email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.getByText(c.accountIntro).waitFor();
    await page.locator('input[name=factorPassword]').fill(password);await page.getByRole('button',{name:c.factorEnable,exact:true}).click();
    const secret=await page.locator('.factor-secret').textContent();assert.ok(secret);
    await page.locator('input[name=factorPassword]').fill(password);await page.locator('input[name=factorConfirmation]').fill(totp(secret));await page.getByRole('button',{name:c.factorActivate,exact:true}).click();
    await page.locator('.factor-codes').waitFor();await page.getByRole('button',{name:c.factorCodesSaved,exact:true}).click();await page.getByRole('heading',{name:c.login,exact:true}).waitFor();
    const activationStep=Number((await f.db.pool.query('SELECT max(time_step) AS step FROM cloud_factor_replays WHERE account_id=$1',[owner.id])).rows[0].step);
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,(activationStep+1)*30000+1000-Date.now())));
    const step=Number((await f.db.pool.query('SELECT floor(extract(epoch FROM clock_timestamp())/30)::bigint AS step')).rows[0].step);
    assert.equal(step,activationStep+1,'database clock has advanced exactly one enrolled-code step');
    assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[owner.id])).rows[0].count,'0');
    await page.locator('input[name=email]').fill(owner.email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.getByText(c.factorLoginHelp,{exact:true}).waitFor();
    assert.equal((await page.context().cookies()).filter(cookie=>cookie.name==='cloud_session').length,0);
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/account/login/factor');
    await page.locator('input[name=factorProof]').fill(signInCode(secret));await page.getByRole('button',{name:c.factorVerify,exact:true}).click();
    assert.equal((await response).status(),200,'a fresh adjacent proof must sign in after the enrolment step rolls over');await page.getByText(c.accountIntro).waitFor();
    await page.getByRole('button',{name:c.signout,exact:true}).click();await page.getByRole('heading',{name:c.login,exact:true}).waitFor();
    await page.locator('input[name=email]').fill(owner.email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.getByText(c.factorLoginHelp,{exact:true}).waitFor();
    const replay=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/account/login/factor');
    await page.locator('input[name=factorProof]').fill(totp(secret,-1));await page.getByRole('button',{name:c.factorVerify,exact:true}).click();
    assert.equal((await replay).status(),401,'the consumed enrolment proof remains refused');assert.equal((await page.context().cookies()).filter(cookie=>cookie.name==='cloud_session').length,0);
    await page.getByText(c.credentials,{exact:true}).first().waitFor();
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,(activationStep+2)*30000+1000-Date.now())));
    const laterStep=Number((await f.db.pool.query('SELECT floor(extract(epoch FROM clock_timestamp())/30)::bigint AS step')).rows[0].step);
    assert.equal(laterStep,activationStep+2,'database clock reaches the next unused previous-code step');
    await page.locator('input[name=email]').fill(owner.email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.getByText(c.factorLoginHelp,{exact:true}).waitFor();
    const previous=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/account/login/factor');
    await page.locator('input[name=factorProof]').fill(totp(secret,-1));await page.getByRole('button',{name:c.factorVerify,exact:true}).click();
    assert.equal((await previous).status(),200,'a fresh previous adjacent proof remains accepted');await page.getByText(c.accountIntro).waitFor();
  }finally{await f.close();}
});

test('navigation and pagehide fence delayed challenges and remove temporary factor secrets',async()=>{
  const f=await startPortalFixture(undefined,undefined,{keys,policy});const page=await f.browser.newPage();page.setDefaultTimeout(5000);
  let release!:(()=>void),entered!:(()=>void);const held=new Promise<void>(r=>{entered=r;});const released=new Promise<void>(r=>{release=r;});
  try{
    await page.route('**/api/account/login',async route=>{entered();await released;await route.fulfill({status:202,json:{factorRequired:true,challengeToken:'A'.repeat(43),expiresAt:new Date(Date.now()+300000).toISOString()}});});
    await page.goto(`${f.origin}/login`);await page.locator('input[name=email]').fill('owner@example.test');await page.locator('input[name=password]').fill(password);
    await page.getByRole('button',{name:translations.en.login,exact:true}).click();await held;
    await page.getByRole('link',{name:translations.en.forgot,exact:true}).click();release();await page.waitForResponse('**/api/account/login');
    await page.getByRole('heading',{name:translations.en.forgot,exact:true}).waitFor();assert.equal(await page.locator('input[name=factorProof]').count(),0);
    await page.getByRole('link',{name:translations.en.login,exact:true}).click();await page.locator('input[name=email]').fill('owner@example.test');await page.locator('input[name=password]').fill(password);
    await page.getByRole('button',{name:translations.en.login,exact:true}).click();await page.getByText(translations.en.factorLoginHelp,{exact:true}).waitFor();
    await page.locator('input[name=factorProof]').fill('123456');await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.equal(await page.locator('input[name=factorProof]').count(),0);assert.equal(await page.locator('input[name=password]').inputValue(),'');
    assert.equal(await page.evaluate(()=>sessionStorage.length),0);
  }finally{release?.();await f.close();}
});

test('password and factor rate refusals show a countdown and allow a deliberate retry after it ends',async()=>{
  const f=await startPortalFixture(undefined,undefined,{keys,policy});const page=await f.browser.newPage();page.setDefaultTimeout(5000);
  let calls=0;
  try{
    await page.clock.install({time:new Date()});
    await page.route('**/api/account/login',async route=>{calls++;await route.fulfill(calls===1?{status:429,headers:{'Retry-After':'1'},json:{error:'rate_limited'}}:{status:401,json:{error:'credentials_invalid'}});});
    await page.goto(`${f.origin}/login`);await page.locator('input[name=email]').fill('owner@example.test');await page.locator('input[name=password]').fill(password);
    await page.getByRole('button',{name:translations.en.login,exact:true}).click();await page.getByText(translations.en.limited,{exact:true}).waitFor();
    await page.getByText(translations.en.cooldown,{exact:false}).waitFor();assert.equal(calls,1);
    await page.clock.runFor(1100);await page.getByText(translations.en.cooldown,{exact:false}).waitFor({state:'hidden'});
    await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:translations.en.login,exact:true}).click();await page.getByText(translations.en.credentials,{exact:true}).waitFor();assert.equal(calls,2);
  }finally{await f.close();}
});
