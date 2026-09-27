import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {readFileSync} from 'node:fs';

function configuration(){return JSON.parse(execFileSync('docker',['compose','--profile','backups','--profile','remote-reconciliation','config','--format','json'],{encoding:'utf8'}));}

test('local stack declares the complete gated service graph',()=>{
 const value=configuration(),services=value.services;
 const required=['postgres','mailpit','bootstrap','migrate','storage','account','email-worker','monitor-worker','usage-reconciler','remote-probe','gateway-manifest','gateway','backup-worker','remote-reconciler'];
 assert.deepEqual(Object.keys(services).sort(),required.sort());
 assert.equal(services.postgres.image,'postgres:18-alpine');
 assert.equal(services.mailpit.image,'axllent/mailpit:v1.31.1');
 for(const name of ['postgres','mailpit','storage','account','gateway'])assert.ok(services[name].healthcheck?.test?.length,name);
 assert.equal(services.account.healthcheck.test.at(-1),'http://localhost:3000/api/health/ready');
 assert.equal(services.migrate.depends_on.postgres.condition,'service_healthy');
 assert.equal(services.migrate.depends_on.bootstrap.condition,'service_completed_successfully');
 for(const name of ['account','email-worker','monitor-worker','usage-reconciler','remote-probe'])assert.equal(services[name].depends_on.migrate.condition,'service_completed_successfully',name);
 assert.equal(services.gateway.depends_on.bootstrap.condition,'service_completed_successfully');
 assert.equal(services.gateway.depends_on['gateway-manifest'].condition,'service_started');
 assert.deepEqual(services['backup-worker'].profiles,['backups']);
 assert.deepEqual(services['remote-reconciler'].profiles,['remote-reconciliation']);
});

test('all host ports stay on loopback and private configuration is volume-mounted',()=>{
 const {services}=configuration();
 for(const [name,service] of Object.entries(services))for(const port of service.ports??[])assert.equal(port.host_ip,'127.0.0.1',`${name}:${port.target}`);
 for(const name of ['bootstrap','migrate','storage','account','email-worker','monitor-worker','usage-reconciler','remote-probe','gateway-manifest','gateway','backup-worker','remote-reconciler']){
  const volumes=services[name].volumes??[];assert.ok(volumes.some(volume=>volume.target==='/run/local-stack'&&volume.type==='volume'),name);
 }
 assert.equal(services.bootstrap.restart,'no');assert.equal(services.migrate.restart,'no');
 assert.equal(services.account.stop_grace_period,'12s');assert.equal(services.gateway.stop_grace_period,'10s');
 assert.ok(services.postgres.volumes.some(volume=>volume.target==='/var/lib/postgresql'&&volume.type==='volume'));
 assert.ok(services.gateway.volumes.some(volume=>volume.target==='/input'&&volume.type==='volume'&&volume.read_only===true));
});

test('Cloud image build carries the pinned storage release inputs',()=>{
 const service=configuration().services.bootstrap,build=service.build;
 assert.match(build.dockerfile,/(^|\/)deploy\/local-stack\/Dockerfile$/);
 assert.equal(build.args.SEAWEED_VERSION,'4.47');
 assert.equal(build.args.SEAWEED_AMD64_SHA256,'31fb804858885f9e7f18b6d3b1da09e824baac3e6a55b5a62c3c4c77e6ed6d7d');
 assert.equal(build.args.SEAWEED_ARM64_SHA256,'ba5c9def9ff98f78becdf309a50a9f906922f6383a7c4c772d01ede3cc012e16');
});

test('legacy Mailpit port overrides and teardown remain service-scoped',()=>{
 const env={...process.env,MAILPIT_SMTP_PORT:'1199',MAILPIT_UI_PORT:'8199'};delete env.LOCAL_STACK_MAILPIT_SMTP_PORT;delete env.LOCAL_STACK_MAILPIT_UI_PORT;
 const value=JSON.parse(execFileSync('docker',['compose','config','--format','json'],{encoding:'utf8',env}));
 assert.deepEqual(value.services.mailpit.ports.map(port=>port.published),['1199','8199']);
 const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;assert.equal(scripts['mail:down'],'docker compose rm -s -f mailpit');
});
