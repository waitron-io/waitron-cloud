import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {translations} from '../src/locale.ts';

const id='12345678-1234-4234-8234-123456789abc',pointId='22345678-1234-4234-8234-123456789abc',venueId='32345678-1234-4234-8234-123456789abc',second='72345678-1234-4234-8234-123456789abc';
const expiresAt='2099-01-01T00:00:00.000Z';
const pending={requestId:id,state:'awaiting_owner',expiresAt,operationId:null,operation:null};
const approved={...pending,state:'approved',operationId:id,operation:{id,pointId,venueId,source:{kind:'snapshot',pointId},mode:'failure',status:'pending',expiresAt}};
const ready={...approved,operation:{...approved.operation,status:'restored'},replacement:{requestId:id,pointId,venueId,source:{kind:'snapshot',pointId},oldInstallationId:'42345678-1234-4234-8234-123456789abc',localVenueId:'52345678-1234-4234-8234-123456789abc',nodeId:'62345678-1234-4234-8234-123456789abc',environment:'test',publicKey:'MCowBQYDK2VwAyEA'+'A'.repeat(43),peerPublicKey:Buffer.alloc(32).toString('base64'),state:'awaiting_owner',expiresAt,organisationName:'Café Sol',legalBusinessName:'Sol SL',registration:null}};
const installation={installationId:ready.replacement.oldInstallationId,venueId,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,overview:{organisationName:'Café Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},services:['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}))};
const bundle=await build({stdin:{contents:`
 import {applyTokens} from '@waitron-io/ui-core/tokens';
 import {PortalApp} from './src/app.ts';
 applyTokens(document.body);
 window.app=new PortalApp(document.querySelector('#portal'));
`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'iife',target:'es2023'});
const styles=await readFile(new URL('../src/styles.css',import.meta.url),'utf8');
const scenarios=[
 {action:'approve',status:400,code:'confirmation_required',key:'recoveryConfirmation',en:/old.server.*data.loss/i,es:/servidor anterior.*pérdida de datos/i},
 {action:'approve',status:400,code:'unverified',key:'recoveryUnverified',en:/verified.*compatible/i,es:/verificada.*compatible/i},
 {action:'approve',status:400,code:'invalid_input',key:'recoveryInput',en:/matching code.*source/i,es:/código.*origen/i},
 {action:'approve',status:409,code:'target_not_fresh',key:'recoveryFreshTarget',en:/fresh replacement/i,es:/sustitución nuevo/i},
 {action:'approve',status:409,code:'recovery_active',key:'recoveryActive',en:/original recovery link.*close/i,es:/enlace.*recuperación.*cierra/i},
 {action:'approve',status:409,code:'conflict',key:'recoveryConflict',en:/request status.*authorised source/i,es:/estado.*origen autorizado/i},
 {action:'replace',status:400,code:'confirmation_required',key:'recoveryReplacementConfirmation',en:/installation.*old server/i,es:/instalación.*servidor anterior/i},
 {action:'replace',status:409,code:'conflict',key:'recoveryReplacementConflict',en:/replacement details.*request status.*complete.*connection/i,es:/datos.*sustitución.*estado.*completado.*conexión/i},
 {action:'close',status:409,code:'approval_required',key:'recoveryApprovalRequired',en:/not been authorised.*request status.*expire/i,es:/no.*autorizada.*estado.*caduque/i},
] as const;

for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: recovery refusals offer reachable status and source checks without another write`,async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const scenario of scenarios)await t.test(`${scenario.action}/${scenario.code}`,async()=>{
   const page=await browser.newPage({locale,colorScheme:theme,viewport:{width,height:1000}});page.setDefaultTimeout(4000);
   try{
    const calls:{path:string;body:Record<string,unknown>}[]=[];let refused=false,snapshotReads=0;
    await page.route('https://portal.test/recover',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
    await page.route('**/api/account/**',route=>{
     const path=new URL(route.request().url()).pathname;
     if(path.endsWith('/session')||path.endsWith('/session/activity'))return route.fulfill({json:{accountId:'owner',expiresAt}});
     if(path.endsWith('/installations'))return route.fulfill({json:{installations:[installation]}});
     if(path.endsWith('/backups/list')){snapshotReads++;return route.fulfill({json:{venueId,points:[pointId,second].map((id,index)=>({id,capturedAt:`2026-10-2${index+3}T10:00:00.000Z`,verification:'verified',retention:'daily',expiresAt,protection:null})),nextCursor:null,defaultPointId:pointId,continuousRecovery:null}});}
     if(path.includes('/recovery/'))calls.push({path,body:route.request().postDataJSON()});
     if(path.endsWith('/recovery/inspect'))return route.fulfill({json:refused?approved:scenario.action==='approve'?pending:scenario.action==='replace'?ready:approved});
     if(path.endsWith('/recovery/'+scenario.action)){refused=true;return route.fulfill({status:scenario.status,json:{error:scenario.code}});}
     return route.fulfill({status:503,json:{error:'temporarily_unavailable'}});
    });
    await page.goto('https://portal.test/recover#request='+id);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle.outputFiles[0]!.text});
    const c=translations[locale];await page.getByRole('textbox',{name:c.pairCode,exact:true}).fill('00123456');await page.getByRole('button',{name:c.pairInspect,exact:true}).click();
    if(scenario.action==='approve'){
     await page.getByLabel(c.recoveryVenue,{exact:true}).selectOption(venueId);await page.getByLabel(c.recoveryStopped,{exact:true}).check();await page.getByLabel(c.recoveryAcceptLoss,{exact:true}).check();
     await page.getByRole('button',{name:c.recoveryApprove,exact:true}).click();
    }else if(scenario.action==='replace'){
     await page.getByLabel(c.recoveryReplacementConfirm,{exact:true}).check();await page.getByRole('button',{name:c.recoveryReplacementApprove,exact:true}).click();
    }else await page.getByRole('button',{name:c.recoveryCancel,exact:true}).click();
    const alert=page.getByRole('alert');await alert.waitFor();const text=await alert.innerText();
    assert.match(text,locale==='en'?scenario.en:scenario.es);assert.doesNotMatch(text,/temporarily unavailable|temporalmente|support|soporte/i);
    assert.equal(text,c[scenario.key as keyof typeof c]);assert.equal(await page.evaluate(()=>(window as any).app.recovery.uncertain),false);
    assert.deepEqual(calls.map(call=>call.path),['/api/account/recovery/inspect','/api/account/recovery/'+scenario.action]);
    if(scenario.code==='unverified'){
     await page.getByRole('button',{name:c.latestSnapshots,exact:true}).click();await page.waitForFunction(() => !(window as any).app.backups.pending);
     assert.match(text,locale==='en'?/verified does not always mean compatible/i:/verificada no siempre significa compatible/i);
     assert.doesNotMatch(text,/choose a verified, compatible|elige una verificada y compatible/i);
     assert.equal(snapshotReads,2);await page.getByLabel(c.chooseSnapshot,{exact:true}).selectOption(second);
     assert.equal(await page.getByLabel(c.recoveryStopped,{exact:true}).isChecked(),false);assert.equal(await page.getByLabel(c.recoveryAcceptLoss,{exact:true}).isChecked(),false);
     assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).isDisabled(),true);assert.equal(calls.length,2);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.RECOVERY_GUIDANCE_RECEIPT_DIR){await mkdir(process.env.RECOVERY_GUIDANCE_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.RECOVERY_GUIDANCE_RECEIPT_DIR}/${locale}-${theme}-${width}-${scenario.action}-${scenario.code}.png`,fullPage:true});}
    await page.getByRole('button',{name:locale==='en'?'Check request status':'Comprobar estado de la solicitud',exact:true}).click();
    await page.getByText(c.recoveryApprovedSnapshot,{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
    assert.deepEqual(calls.map(call=>call.path),['/api/account/recovery/inspect','/api/account/recovery/'+scenario.action,'/api/account/recovery/inspect']);
    assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:c.recoveryReplacementApprove,exact:true}).count(),0);
   }finally{await page.close();}
  });
 }finally{await browser.close();}
});
