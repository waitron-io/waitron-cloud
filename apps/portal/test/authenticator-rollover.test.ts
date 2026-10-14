import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {hashSecret} from '@waitron-cloud/identity';
import {startPortalFixture} from './fixtures.ts';
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
