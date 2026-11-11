import assert from 'node:assert/strict';
import axe from 'axe-core';
import {createHmac,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {hashSecret} from '@waitron-cloud/identity';
import {startPortalFixture, completeBrowserEmail, addVirtualAuthenticator} from './fixtures.ts';
import {translations} from '../src/locale.ts';

for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])
test(`required passkey enrollment ${locale} ${colorScheme} ${width}`, async () => {
  const f = await startPortalFixture(undefined, undefined, undefined, undefined, true);
  const context = await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}}), page = await context.newPage(); page.setDefaultTimeout(5000);
  const authenticator = await addVirtualAuthenticator(context, page);
  const id = randomUUID(), email = `enrollment-${id}@example.test`, password = 'A synthetic enrollment password', c = translations[locale];
  try {
    await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [id]);
    await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)', [id,email,await hashSecret(password)]);
    await page.goto(`${f.origin}/login#lang=${locale}`); await page.getByLabel(c.email).fill(email);
    await page.locator('input[name=password]').fill(password); await page.getByRole('button', {name:c.login,exact:true}).click();
    await completeBrowserEmail(f, page, email, locale);
    await page.getByRole('heading', {name:c.enrollmentRequiredTitle,exact:true}).waitFor();
    assert.equal(await page.getByText(c.accountIntro,{exact:true}).count(),0);
    await look(page,`${locale}-${colorScheme}-${width}-passkey`);
    await page.locator('input[name=passkeyPassword]').fill(password);
    await page.getByRole('button',{name:c.passkeyAdd,exact:true}).click();
    await page.getByText(c.accountIntro,{exact:true}).waitFor();
    assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_passkeys WHERE account_id=$1',[id])).rows[0].count,'1');
  } finally {await authenticator.close();await context.close();await f.close();}
});


const keys={activeKeyId:'browser',keys:{browser:'ac'.repeat(32)}};
const rule={limit:1000,windowSeconds:60},policy={loginLifetimeMs:300000,pendingLifetimeMs:300000,challengeAttempts:10,enrolmentAttempts:10,
 loginAccount:rule,completeIp:rule,completeAccount:rule,completeChallenge:rule,manageIp:rule,manageAccount:rule};
for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])
test(`required app enrollment from recovery ${locale} ${colorScheme} ${width}`,async()=>{
 const f=await startPortalFixture(undefined,undefined,{keys,policy},undefined,true);
 const context=await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(5000);
 const id=randomUUID(),email=`app-enrollment-${id}@example.test`,password='A synthetic required app password',c=translations[locale];
 try{
  await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
  await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[id,email,await hashSecret(password)]);
  await page.goto(`${f.origin}/login#lang=${locale}`);await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);
  await page.getByRole('button',{name:c.login,exact:true}).click();await completeBrowserEmail(f,page,email,locale);
  await page.getByRole('heading',{name:c.enrollmentRequiredTitle,exact:true}).waitFor();
  await page.goto(`${f.origin}/recover`);await page.getByRole('heading',{name:c.enrollmentRequiredTitle,exact:true}).waitFor();
  await page.locator('input[name=factorPassword]').fill(password);await look(page,`${locale}-${colorScheme}-${width}-app`);await page.getByRole('button',{name:c.factorEnable,exact:true}).click();
  await page.locator('.factor-secret').waitFor();await page.getByRole('button',{name:c.factorCancel,exact:true}).click();await page.locator('.factor-secret').waitFor({state:'detached'});
  assert.equal(await page.getByText(c.accountIntro,{exact:true}).count(),0);assert.equal(await page.locator('.factor-secret').count(),0);
  await page.locator('input[name=factorPassword]').fill(password);await page.getByRole('button',{name:c.factorEnable,exact:true}).click();
  const secret=await page.locator('.factor-secret').textContent();assert.ok(secret);await look(page,`${locale}-${colorScheme}-${width}-pending`);
  const bits=[...secret].map(ch=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5,'0')).join(''),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const mac=createHmac('sha1',Buffer.from(bits.match(/.{8}/g)!.map(b=>parseInt(b,2)))).update(counter).digest();
  const code=((mac.readUInt32BE(mac[19]!&15)&0x7fffffff)%1000000).toString().padStart(6,'0');
  await page.locator('input[name=factorPassword]').fill(password);await page.locator('input[name=factorConfirmation]').fill(code);
  await page.getByRole('button',{name:c.factorActivate,exact:true}).click();await page.getByRole('heading',{name:c.factorCodesTitle,exact:true}).waitFor();
  assert.equal(await page.locator('.factor-codes code').count(),10);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions WHERE account_id=$1 AND ended_at IS NULL',[id])).rows[0].count,'0');
 }finally{await context.close();await f.close();}
});

async function look(page: import('playwright').Page,name: string){
 await page.evaluate(axe.source);
 const violations=await page.evaluate(async()=>(await window.axe.run(document)).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
 assert.deepEqual(violations,[],name);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const dir=process.env.REQUIRED_ENROLLMENT_SHOTS;if(!dir)return;await mkdir(dir,{recursive:true});
 const scroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));await page.screenshot({path:`${dir}/${name}.png`,fullPage:true});
 await page.evaluate(({x,y})=>scrollTo(x,y),scroll);
}
