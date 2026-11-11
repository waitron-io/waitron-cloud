import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {hashSecret} from '@waitron-cloud/identity';
import {startPortalFixture,mailFor} from './fixtures.ts';
import {translations} from '../src/locale.ts';
const rule={limit:1000,windowSeconds:60};
const policy={loginLifetimeMs:300000,pendingLifetimeMs:300000,challengeAttempts:5,enrolmentAttempts:5,
  loginAccount:rule,completeIp:rule,completeAccount:rule,completeChallenge:rule,manageIp:rule,manageAccount:rule};
for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])
test(`email sign-in ${locale} ${colorScheme} ${width}: password waits for the mailbox code`,async()=>{
  const f=await startPortalFixture(undefined,undefined,{keys:null,policy});
  const context=await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(7000);
  const id=randomUUID(),email=`check-${id}@example.test`,password='A synthetic mailbox password',c=translations[locale];
  try{
    await f.db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);
    await f.db.pool.query('INSERT INTO cloud_credentials(account_id,email,password_hash) VALUES($1,$2,$3)',[id,email,await hashSecret(password)]);
    await f.db.pool.query('INSERT INTO cloud_passkey_users(account_id,user_handle) VALUES($1,$2)',[id,randomBytes(32)]);
    await f.db.pool.query(`INSERT INTO cloud_passkeys(id,account_id,credential_id,public_key,counter,device_type,backed_up)
      VALUES($1,$2,'c3ludGhldGlj',$3,0,'multiDevice',true)`,[randomUUID(),id,Buffer.from([1,2,3])]);
    await page.goto(`${f.origin}/login#lang=${locale}`);await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);
    const answer=page.waitForResponse('**/api/account/login');await page.getByRole('button',{name:c.login,exact:true}).click();assert.equal((await answer).status(),202);
    await page.getByRole('heading',{name:locale==='en'?'Check your email':'Revisa tu correo',exact:true}).waitFor();
    assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_session'),false);
    assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');assert.equal(await page.getByLabel(c.factorProofType,{exact:true}).count(),0);
    if(process.env.EMAIL_SIGN_IN_RECEIPT_DIR)await page.screenshot({path:`${process.env.EMAIL_SIGN_IN_RECEIPT_DIR}/${locale}-${colorScheme}-${width}.png`,fullPage:true});
    await f.drainMail();const message=await mailFor(email,locale==='en'?'Your Waitron Cloud sign-in code':'Tu código de acceso a Waitron Cloud',f.mailEvidence);
    const code=message.match(/^([0-9]{6})$/m)?.[1];assert.ok(code);
    await page.locator('input[name=factorProof]').fill(code);await page.getByRole('button',{name:c.factorVerify,exact:true}).click();await page.getByText(c.accountIntro).waitFor();
    assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_session'),true);
  }finally{await context.close();await f.close();}
});
