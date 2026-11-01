import assert from 'node:assert/strict';
import test from 'node:test';
import {digest} from './schema-upgrade-fixture.mjs';
import * as fixture from './schema-upgrade-fixture.mjs';
test('operation receipt digest ignores PostgreSQL jsonb object key ordering',()=>{
 assert.equal(digest({lease:{payload:'same',signature:'same'},installationId:'same'}),digest({installationId:'same',lease:{signature:'same',payload:'same'}}));
 assert.notEqual(digest({items:['first','second']}),digest({items:['second','first']}));
});
test('upgrade revisions preserve historical defaults and accept only a complete explicit pinned pair',()=>{
 assert.equal(typeof fixture.upgradeRevisions,'function','explicit upgrade releases are unavailable');
 assert.deepEqual(fixture.upgradeRevisions([]),{oldHead:'9a56d0122bf6872a0200735a7b1e3a23ad4f825c',newHead:'eafd97ad5ac51563e91c821d4c957ef996e5d3fb',factor:false});
 assert.deepEqual(fixture.upgradeRevisions(['--old','a'.repeat(40),'--new','b'.repeat(40)]),{oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:true});
 for(const args of [['--old','a'.repeat(40)],['--new','b'.repeat(40)],['--old','main','--new','b'.repeat(40)],['--old','a'.repeat(40),'--new','a'.repeat(40)],['--old','a'.repeat(40),'--new','b'.repeat(40),'--force'],['--old','a'.repeat(40),'--old','a'.repeat(40),'--new','b'.repeat(40)]])assert.throws(()=>fixture.upgradeRevisions(args),/revisions/);
});
test('upgrade fixture generates six-digit SHA1 codes from independent RFC 6238 vectors',()=>{
 assert.equal(typeof fixture.factorCode,'function','authenticator upgrade proof is unavailable');
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 assert.equal(fixture.factorCode(secret,59000),'287082');assert.equal(fixture.factorCode(secret,1111111109000),'081804');
});
test('relay stop upgrades require their own mode and two distinct pinned revisions',()=>{
 const pair=['--old','a'.repeat(40),'--new','b'.repeat(40)];
 const want={oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:false,relayStop:true};
 assert.deepEqual(fixture.upgradeRevisions(['--relay-stop',...pair]),want);
 assert.deepEqual(fixture.upgradeRevisions([...pair,'--relay-stop']),want);
 for(const args of [['--relay-stop'],['--relay-stop','--old','a'.repeat(40)],['--relay-stop','--old','main','--new','b'.repeat(40)],['--relay-stop','--old','a'.repeat(40),'--new','a'.repeat(40)],['--relay-stop','--relay-stop',...pair],['--relay-stop','--factor',...pair],['--relay-stop',...pair,'--force']])assert.throws(()=>fixture.upgradeRevisions(args),/revisions/);
});
test('monitoring quiet upgrades select only their complete distinct pinned pair',()=>{
 const pair=['--old','a'.repeat(40),'--new','b'.repeat(40)],want={oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:false,monitoringQuiet:true};
 assert.deepEqual(fixture.upgradeRevisions(['--monitoring-quiet',...pair]),want);assert.deepEqual(fixture.upgradeRevisions([...pair,'--monitoring-quiet']),want);
 for(const args of [['--monitoring-quiet'],['--monitoring-quiet','--old','a'.repeat(40)],['--monitoring-quiet','--old','main','--new','b'.repeat(40)],['--monitoring-quiet','--old','a'.repeat(40),'--new','a'.repeat(40)],['--monitoring-quiet','--monitoring-quiet',...pair],['--monitoring-quiet','--relay-stop',...pair],['--relay-stop','--monitoring-quiet',...pair]])assert.throws(()=>fixture.upgradeRevisions(args),/revisions/);
});
test('backup verification upgrades select only their complete pinned pair without selecting a historical proof',()=>{
 const pair=['--old','a'.repeat(40),'--new','b'.repeat(40)],want={oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:false,backupVerification:true};
 assert.deepEqual(fixture.upgradeRevisions(['--backup-verification',...pair]),want);
 assert.deepEqual(fixture.upgradeRevisions([...pair,'--backup-verification']),want);
 for(const args of [['--backup-verification'],['--backup-verification',...pair,'--backup-verification'],['--backup-verification','--relay-stop',...pair],['--monitoring-quiet','--backup-verification',...pair],['--backup-verification','--old','main','--new','b'.repeat(40)]])assert.throws(()=>fixture.upgradeRevisions(args),/revisions/);
});

test('billing upgrade mode requires a distinct pinned pair',()=>{
 const pair=['--old','a'.repeat(40),'--new','b'.repeat(40)],want={oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:false,billing:true};
 assert.deepEqual(fixture.upgradeRevisions(['--billing',...pair]),want);
 assert.deepEqual(fixture.upgradeRevisions([...pair,'--billing']),want);
 for(const args of [['--billing'],['--billing','--old','a'.repeat(40)],['--billing','--old','main','--new','b'.repeat(40)],['--billing','--old','a'.repeat(40),'--new','a'.repeat(40)],['--billing',...pair,'--billing'],...['--relay-stop','--monitoring-quiet','--backup-verification'].flatMap(mode=>[['--billing',mode,...pair],[mode,...pair,'--billing']])])assert.throws(()=>fixture.upgradeRevisions(args),/revisions/);
});

test('billing proof failures preserve known error codes without leaking private details',()=>{
 assert.equal(typeof fixture.upgradeFailure,'function');
 const stack='Error: synthetic private payload\n    at seedBilling (file:///tmp/private/schema-upgrade-billing-fixture.mjs:72:4)';
 for(const code of ['billing_state_conflict','invalid_billing_input','ERR_ASSERTION','23503'])assert.deepEqual(fixture.upgradeFailure({code,stack,message:'never-log-this'},'upgrade'),{event:'schema-upgrade-failed',phase:'upgrade',code,location:'schema-upgrade-billing-fixture.mjs:72:4'});
 for(const code of ['private-payload','synthetic_secret_reference','x'.repeat(100),null,{}])assert.equal(fixture.upgradeFailure({code,stack,message:'never-log-this'},'upgrade').code,'proof_failed');
 assert.deepEqual(fixture.upgradeFailure(null,'restore'),{event:'schema-upgrade-failed',phase:'restore',code:'proof_failed',location:'unknown'});
 assert.equal(JSON.stringify(fixture.upgradeFailure({code:'billing_state_conflict',stack,message:'never-log-this',secret:'never-log-this'},'upgrade')).includes('private'),false);
});

test('venue service upgrades select only their own complete distinct pinned pair',()=>{
 const pair=['--old','a'.repeat(40),'--new','b'.repeat(40)],want={oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:false,venueServices:true};
 assert.deepEqual(fixture.upgradeRevisions(['--venue-services',...pair]),want);
 assert.deepEqual(fixture.upgradeRevisions([...pair,'--venue-services']),want);
 for(const args of [['--venue-services'],['--venue-services','--old','main','--new','b'.repeat(40)],['--venue-services','--old','a'.repeat(40),'--new','a'.repeat(40)],['--venue-services',...pair,'--venue-services'],...['--billing','--backup-verification','--monitoring-quiet','--relay-stop'].flatMap(mode=>[[mode,'--venue-services',...pair],['--venue-services',mode,...pair]])])assert.throws(()=>fixture.upgradeRevisions(args),/revisions/);
});

test('allowance upgrades select only their own complete distinct pinned pair',()=>{
 const pair=['--old','a'.repeat(40),'--new','b'.repeat(40)],want={oldHead:'a'.repeat(40),newHead:'b'.repeat(40),factor:false,allowances:true};
 assert.deepEqual(fixture.upgradeRevisions(['--allowances',...pair]),want);
 assert.deepEqual(fixture.upgradeRevisions([...pair,'--allowances']),want);
 for(const args of [['--allowances'],['--allowances','--old','a'.repeat(40)],['--allowances','--old','main','--new','b'.repeat(40)],['--allowances','--old','a'.repeat(40),'--new','a'.repeat(40)],['--allowances',...pair,'--allowances'],['--allowances',...pair,'--force'],...['--venue-services','--billing','--backup-verification','--monitoring-quiet','--relay-stop'].flatMap(mode=>[[mode,'--allowances',...pair],['--allowances',mode,...pair]])])assert.throws(()=>fixture.upgradeRevisions(args),/revisions/);
});
