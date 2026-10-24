import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const first='20000000-0000-4000-8000-000000000001',second='20000000-0000-4000-8000-000000000002',request='20000000-0000-4000-8000-000000000003';
const names=['A Cooperativa de Restaurantes y Cafeterías del Mediterráneo SL','Z Asociación de Hostelería y Restauración de la Costa Brava SL'];
const installations=[first,second].map((id,index)=>({
 installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,
 overview:{organisationName:names[index],businessName:index?'Café Mar':'Café Sol',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
 services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),
}));
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: a long organisation name keeps recovery within the viewport and its choice usable`,async()=>{
 const browser=await chromium.launch({headless:true});
 let release:(()=>void)|undefined;
 try{
  const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});page.setDefaultTimeout(4000);
  let gate:Promise<void>|undefined,entered:(()=>void)|undefined;
  await page.route('https://portal.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
   if(path.endsWith('/installations')){entered?.();await gate;return route.fulfill({json:{installations}});}
   if(path.endsWith('/recovery/inspect'))return route.fulfill({json:{requestId:request,state:'awaiting_owner',expiresAt:new Date(Date.now()+600000).toISOString(),operationId:null,operation:null}});
   if(path.startsWith('/api/'))return route.fulfill({status:503,json:{error:'unavailable'}});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'});
  });
  await page.goto(`https://portal.test/recover#request=${request}`);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  const c=translations[locale];
  await page.locator('wt-input[name="recoveryCode"] input').fill('00123456');
  await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
  const organisation=page.getByLabel(c.recoveryOrganisation,{exact:true});await organisation.waitFor();
  assert.equal(await organisation.isEnabled(),true);
  await organisation.selectOption(second);
  assert.equal(await organisation.inputValue(),second);
  assert.equal(await organisation.locator('option:checked').textContent(),names[1]);
  await page.getByLabel(c.recoveryVenue,{exact:true}).locator('option',{hasText:'Café Mar'}).waitFor({state:'attached'});
  const dimensions=await organisation.evaluate(el=>({window:innerWidth,scroll:document.documentElement.scrollWidth,select:el.getBoundingClientRect().width,parent:el.parentElement!.getBoundingClientRect().width}));
  console.log(`${locale} ${theme} ${width}: ${JSON.stringify(dimensions)}`);
  if(process.env.RECOVERY_WIDTH_RECEIPT_DIR){await mkdir(process.env.RECOVERY_WIDTH_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_WIDTH_RECEIPT_DIR}/${locale}-${theme}-${width}.png`,fullPage:true});}
  assert.ok(dimensions.scroll<=width,`page width ${dimensions.scroll} exceeds viewport ${width}`);
  assert.ok(dimensions.select<=dimensions.parent,`select width ${dimensions.select} exceeds label ${dimensions.parent}`);
  const reading=new Promise<void>(resolve=>{entered=resolve;});gate=new Promise<void>(resolve=>{release=resolve;});
  await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();await reading;
  assert.equal(await organisation.isDisabled(),true);assert.equal(await organisation.inputValue(),second);
  release?.();gate=undefined;
  await page.waitForFunction(label=>!(document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement)?.disabled,c.recoveryOrganisation);
  assert.equal(await organisation.inputValue(),second);
 }finally{release?.();await browser.close();}
});
