// Executed only in the pinned genuine Waitron image; its disposable tmpfs never starts a venue server.
import {readFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
let stage='imports';process.on('uncaughtException',error=>{console.error('fixture-error:'+stage+':'+(/^[a-zA-Z_.0-9]+$/.test(error.code??'')?error.code:error.name));process.exit(1);});
const require=createRequire('/waitron/apps/server/package.json');
const {openVenueDatabase}=require('@waitron/db'),{applyMigrations,manifestSets,migrationOptionsFor}=require('@waitron/migrations');
const {hashPin,hashPassword}=require('@waitron/identity');
const {provisionVenue,venueModuleConfig}=await import('/waitron/apps/server/src/provision.ts');
const {ensureBoxSecrets}=await import('/waitron/apps/server/src/box-secrets.ts');
const {writeTradingEnv}=await import('/waitron/apps/server/src/trading-config.ts');
let text='';for await(const bytes of process.stdin){text+=bytes;if(text.length>65536)throw Error('fixture.input');}const input=JSON.parse(text);
const root=await mkdtemp('/tmp/cloud-integration-backup-d79-'),venue=join(root,'venue');
stage='migrations';await applyMigrations(venue,migrationOptionsFor(manifestSets(),null));
const store=await openVenueDatabase(venue);let provisioned;
stage='provision';try{provisioned=await provisionVenue({ownerDb:store.venue,moduleConfig:venueModuleConfig({overrides:new Map()},'ES-common'),database:'d79-snapshot',stateDir:root},{environment:'preproduction',initialAllocation:{kind:'throwaway',hostEnvironment:'preproduction'},venue:{country:'ES',taxId:'73000001K',legalName:'Cloud Test SL',location:{name:'D79 Snapshot Venue',fiscalTerritory:'ES-common',invoiceLocales:['es-ES'],operationDescription:'Venta de prueba',addressLine1:'Calle Mayor 1',addressLine2:null,postalCode:'28013',city:'Madrid',province:'Madrid',timeZone:'Europe/Madrid',dayCutover:'05:00'},seriesCode:'A',rectificativeSeriesCode:'R',admin:{displayName:'Cloud test manager',pinHash:hashPin('1234'),passwordHash:hashPassword('Local integration password'),email:'owner@example.test',locale:'en-GB'}}});}finally{await store.close();}
stage='secrets';await ensureBoxSecrets({stateDir:root,hostnames:['localhost'],now:()=>new Date(),listIpv4:()=>[]});
await writeTradingEnv(root,{nodeId:provisioned.nodeId,locationId:provisioned.locationId,environment:'preproduction',developmentMode:true,onboardingIntent:'demo'});
// A complete preproduction archive includes its test certificate through Waitron's normal vault writer.
// No captured record or fiscal allocation is rewritten to satisfy verification.
stage='certificate';
const {makeAuthority}=await import('/waitron/packages/fiscal-verifactu/test/certificate-fixtures.ts');
const {sealAeatSecret}=await import('/waitron/packages/fiscal-verifactu/src/provisioning-secret.ts');
const {loadBoxEnv}=await import('/waitron/apps/server/src/box-env.ts');
const {loadKeyRing}=require('@waitron/credentials');
const certificate=makeAuthority().issue({organizationIdentifier:'VATES-73000001K'}),certificateStore=await openVenueDatabase(venue);
try{await sealAeatSecret({db:certificateStore.venue,ring:loadKeyRing(await loadBoxEnv({},root)),nodeId:provisioned.nodeId},{pfxBase64:certificate.pfx.toString('base64'),passphrase:certificate.passphrase,certKind:'sello'});}finally{await certificateStore.close();}
stage='capture';const child=spawn(process.execPath,['--permission','--allow-fs-read=*','--allow-fs-write='+root,'--allow-worker','--allow-child-process','--allow-addons','--import',require.resolve('tsx'),'/waitron/apps/server/scripts/cloud-backup-fixture.ts'],{cwd:'/waitron/apps/server',env:{...process.env,TSX_DISABLE_CACHE:'1',CLOUD_TEST_ROOT:root},stdio:['pipe','pipe','pipe']});
let output='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',()=>{});child.stdin.end(JSON.stringify({command:'capture',recoveryKey:input.recoveryKey}));
const timer=setTimeout(()=>child.kill('SIGKILL'),30000);let code;try{code=await new Promise(resolve=>child.once('close',resolve));}finally{clearTimeout(timer);}if(code!==0)throw Error('fixture.capture_failed');
const metadata=JSON.parse(output.trim().split('\n').at(-1));
console.log(JSON.stringify({metadata,archive:(await readFile(join(root,'captured.backup.enc'))).toString('base64')}));
