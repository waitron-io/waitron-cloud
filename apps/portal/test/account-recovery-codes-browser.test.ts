import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {hashSecret} from '@waitron-cloud/identity';
import {startPortalFixture,completeBrowserEmail} from './fixtures.ts';
import {translations} from '../src/locale.ts';
const rule={limit:1000,windowSeconds:60},policy={loginLifetimeMs:300000,pendingLifetimeMs:300000,challengeAttempts:5,enrolmentAttempts:5,
 loginAccount:rule,completeIp:rule,completeAccount:rule,completeChallenge:rule,manageIp:rule,manageAccount:rule};
for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])
test(`passkey recovery ${locale} ${colorScheme} ${width}`,async()=>{
 const f=await startPortalFixture(undefined,undefined,{keys:null,policy});
 const context=await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(7000);
 const id=randomUUID(),email=`recovery-${id}@example.test`,password='A synthetic saved code password',c=translations[locale];
 const shots=process.env.ACCOUNT_RECOVERY_SHOTS;
 async function look(stage:string){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(shots){await mkdir(shots,{recursive:true});await page.screenshot({path:`${shots}/${locale}-${colorScheme}-${width}-${stage}.png`,fullPage:true});}}
 async function login(){await page.goto(`${f.origin}/login#lang=${locale}`);await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.locator('input[name=factorProof]').waitFor();}
 try{
  await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
  await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[id,email,await hashSecret(password)]);
  await f.db.pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[id,randomBytes(32)]);
  await f.db.pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
   VALUES($1,$2,'c3ludGhldGlj',$3,0,'multiDevice',true)`,[randomUUID(),id,Buffer.from([1,2,3])]);
  await login();await completeBrowserEmail(f,page,email,locale);await page.getByText(c.accountIntro).waitFor();
  await page.locator('input[name=passkeyPassword]').fill(password);await look('account');
  await page.getByRole('button',{name:c.factorRegenerate,exact:true}).click();await page.getByRole('heading',{name:c.factorCodesTitle,exact:true}).waitFor();
  const codes=await page.locator('.factor-codes code').allTextContents();assert.equal(codes.length,10);assert.equal(new Set(codes).size,10);await look('codes');
  await page.getByRole('button',{name:c.factorCodesSaved,exact:true}).click();await login();
  await page.getByLabel(c.factorProofType,{exact:true}).selectOption('recovery');await look('challenge');
  assert.equal(await page.getByRole('checkbox',{name:c.rememberBrowser}).count(),0);
  await page.locator('input[name=factorProof]').fill(codes[0]!);await page.getByRole('button',{name:c.factorVerify,exact:true}).click();await page.getByText(c.accountIntro).waitFor();
  assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_session'),true);
  assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_browser'),false);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_factor_recovery_codes WHERE consumed_at IS NULL')).rows[0].count,'9');
  const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage},url:location.href}));for(const code of codes)assert.equal(stored.includes(code),false);
 }finally{await context.close();await f.close();}
});
