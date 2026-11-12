import {run} from 'node:test';
import {inspect} from 'node:util';
const files=[
 'deploy/test-cloud/venue-service-storage.test.mjs','deploy/test-cloud/venue-service-composition.test.mjs','packages/backups/test/venue-service-streams.test.ts',
 'packages/backups/test/venue-service-backups.test.ts','packages/backups/test/venue-service-captures.test.ts','packages/backups/test/venue-service-replacement.test.ts',
 'packages/remote-access/test/venue-service-remote.test.ts','packages/remote-access/test/venue-service-remote-boundaries.test.ts','packages/remote-access/test/venue-service-report-authority.test.ts',
 'packages/account-http/test/venue-service-recovery.test.ts','packages/account-http/test/venue-service-replacement.test.ts',
 'packages/registration/test/venue-service-installations.test.ts','packages/registration/test/venue-service-registration-races.test.ts',
 'packages/translation/test/venue-service-translation.test.ts','packages/translation/test/venue-service-queue.test.ts','packages/translation/test/worker-cli.test.ts',
 'deploy/test-cloud/venue-service-runtime.test.mjs','scripts/venue-service-cli.test.mjs','deploy/test-cloud/venue-service-startup.test.mjs',
 'packages/registration/test/venue-service-relay.test.ts','packages/registration/test/venue-service-rules.test.ts',
];
const started=performance.now();
console.log(JSON.stringify({node:process.version,files,concurrency:4,timeout:120000}));
for await(const event of run({files,concurrency:4,timeout:120000,execArgv:[]})){
 if(['test:fail','test:stderr','test:stdout'].includes(event.type)){
  console.log('RAW_DIAGNOSTIC',event.type,inspect(event.data,{depth:10,colors:false}));
  if(event.type==='test:fail')process.exitCode=1;
 }
 if(event.type==='test:complete')console.log(JSON.stringify({event:event.type,name:event.data.name,file:event.data.file,elapsedMs:performance.now()-started,details:event.data.details}));
 if(event.type==='test:summary')console.log('RAW_SUMMARY',inspect(event.data,{depth:5,colors:false}));
}
