import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {SignupStore} from '@waitron-cloud/registration';
import {hashSecret} from '@waitron-cloud/identity';
import {startPortalFixture,mailFor,completeBrowserEmail} from './fixtures.ts';
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
    assert.equal(await page.getByRole('checkbox',{name:c.rememberBrowser}).isChecked(),false);
    assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_session'),false);
    assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');assert.equal(await page.getByLabel(c.factorProofType,{exact:true}).count(),0);
    if(process.env.EMAIL_SIGN_IN_RECEIPT_DIR)await page.screenshot({path:`${process.env.EMAIL_SIGN_IN_RECEIPT_DIR}/${locale}-${colorScheme}-${width}.png`,fullPage:true});
    await f.drainMail();const message=await mailFor(email,locale==='en'?'Your Waitron Cloud sign-in code':'Tu código de acceso a Waitron Cloud',f.mailEvidence);
    const code=message.match(/^([0-9]{6})$/m)?.[1];assert.ok(code);
    await page.locator('input[name=factorProof]').fill(code==='123456'?'654321':'123456');await page.getByRole('button',{name:c.factorVerify,exact:true}).click();
    await page.getByText(c.emailCheckInvalid,{exact:true}).waitFor();assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_session'),false);
    if(process.env.EMAIL_SIGN_IN_RECEIPT_DIR)await page.screenshot({path:`${process.env.EMAIL_SIGN_IN_RECEIPT_DIR}/${locale}-${colorScheme}-${width}-incorrect.png`,fullPage:true});
    await page.locator('input[name=factorProof]').fill(code);await page.getByRole('button',{name:c.factorVerify,exact:true}).click();await page.getByText(c.accountIntro).waitFor();
    assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_session'),true);
  }finally{await context.close();await f.close();}
});

for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])
test(`password-only recognition ${locale} ${colorScheme} ${width}`,async()=>{
  const f=await startPortalFixture(),context=await f.browser.newContext({locale,colorScheme,viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(7000);
  const id=randomUUID(),email=`browser-${id}@example.test`,password='A synthetic recognised browser password',c=translations[locale];
  try{
    const signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email,locale);
    const verification=f.db.outbox.open((await f.db.pool.query("SELECT * FROM email_outbox WHERE kind='verification'")).rows[0]);assert.ok('token' in verification);
    await page.goto(`${f.origin}/signup#token=${verification.token}&lang=${locale}`);await page.getByLabel(c.legalName).fill('Synthetic Café');await page.locator('input[name=password]').fill(password);
    const signupChoice=page.getByRole('checkbox',{name:c.rememberBrowser});assert.equal(await signupChoice.isChecked(),false);await signupChoice.check();
    if(process.env.EMAIL_SIGN_IN_RECEIPT_DIR)await page.screenshot({path:`${process.env.EMAIL_SIGN_IN_RECEIPT_DIR}/signup-${locale}-${colorScheme}-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:c.create,exact:true}).click();await page.getByText(c.signupReady).waitFor();
    assert.equal((await context.cookies()).some(cookie=>cookie.name==='cloud_session'),false);assert.ok((await context.cookies()).find(cookie=>cookie.name==='cloud_browser')?.httpOnly);
    assert.equal((await f.db.pool.query('SELECT count(*) FROM cloud_sessions')).rows[0].count,'0');
    await context.clearCookies();
    await page.goto(`${f.origin}/login#lang=${locale}`);await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
    const remember=page.getByRole('checkbox',{name:c.rememberBrowser});assert.equal(await remember.isChecked(),false);await remember.check();
    if(process.env.EMAIL_SIGN_IN_RECEIPT_DIR)await page.screenshot({path:`${process.env.EMAIL_SIGN_IN_RECEIPT_DIR}/remember-${locale}-${colorScheme}-${width}.png`,fullPage:true});
    await completeBrowserEmail(f,page,email,locale);await page.getByText(c.accountIntro).waitFor();
    const cookie=(await context.cookies()).find(cookie=>cookie.name==='cloud_browser');assert.ok(cookie?.httpOnly);assert.equal(cookie.sameSite,'Lax');
    await page.getByRole('button',{name:c.signout,exact:true}).click();await page.getByText(c.signedOut).waitFor();
    await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);
    const reply=page.waitForResponse('**/api/account/login');await page.getByRole('button',{name:c.login,exact:true}).click();assert.equal((await reply).status(),200);await page.getByText(c.accountIntro).waitFor();
    assert.equal((await f.db.pool.query("SELECT count(*) FROM email_outbox WHERE kind='sign_in_check'")).rows[0].count,'1');
  }finally{await context.close();await f.close();}
});
