import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test,type TestContext} from 'node:test';
import {
  ChangeResourceRecordSetsCommand,
  CreateHostedZoneCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
  type GetChangeCommandOutput,
} from '@aws-sdk/client-route-53';
import {createRoute53DnsProvider} from '../src/route53-dns.ts';

const endpoint=process.env.AWS_EMULATOR_ENDPOINT;
const credentialsFile=process.env.AWS_EMULATOR_CREDENTIALS_FILE;
const skip=endpoint&&credentialsFile?false:
  'AWS Emulator is not running: set AWS_EMULATOR_ENDPOINT and AWS_EMULATOR_CREDENTIALS_FILE (Linux CI only; see .github/workflows/aws-emulator.yml)';
const tokenA='A'.repeat(43);
const tokenB='B'.repeat(43);

async function hostedZone(t:TestContext) {
  assert.ok(endpoint&&credentialsFile);
  const url=new URL(endpoint);
  assert.ok(url.protocol==='https:'&&url.hostname==='127.0.0.1','Route 53 emulator must use loopback HTTPS');
  const contents=readFileSync(credentialsFile,'utf8');
  const accessKeyId=contents.match(/^aws_access_key_id\s*=\s*(\S+)\s*$/m)?.[1];
  const secretAccessKey=contents.match(/^aws_secret_access_key\s*=\s*(\S+)\s*$/m)?.[1];
  assert.ok(accessKeyId&&secretAccessKey,'AWS Emulator credentials are missing');

  const client=new Route53Client({region:'us-east-1',endpoint,credentials:{accessKeyId,secretAccessKey}});
  t.after(()=>client.destroy());
  const suffix=`${randomUUID().slice(0,8)}.emulator.test.waitron.io`;
  const created=await client.send(new CreateHostedZoneCommand({Name:suffix,CallerReference:randomUUID()}));
  const zoneId=created.HostedZone?.Id?.split('/').at(-1);
  assert.ok(zoneId,'Route 53 did not return a hosted zone ID');

  const commands:{name:string|undefined;status?:string}[]=[];
  client.middlewareStack.add((next,context)=>async args=>{
    const command={name:context.commandName,status:undefined as string|undefined};
    commands.push(command);
    const result=await next(args);
    if(command.name==='GetChangeCommand')
      command.status=(result.output as GetChangeCommandOutput).ChangeInfo?.Status;
    return result;
  },{step:'initialize',name:'observeEmulatorChanges'});
  const venue=`staff-v-11111111-1111-4111-8111-111111111111.${suffix}`;
  return {
    client,zoneId,venue,challenge:`_acme-challenge.${venue}`,commands,
    dns:createRoute53DnsProvider({zoneId,suffix},client),
    async records(name:string) {
      const result=await client.send(new ListResourceRecordSetsCommand({HostedZoneId:zoneId}));
      return result.ResourceRecordSets?.filter(record=>record.Name?.replace(/\.$/,'')===name)
        .map(({Type,TTL,ResourceRecords})=>({Type,TTL,ResourceRecords}));
    },
  };
}

function assertInsync(commands:Awaited<ReturnType<typeof hostedZone>>['commands']) {
  assert.deepEqual(commands.at(-1),{name:'GetChangeCommand',status:'INSYNC'});
  const statuses=commands.filter(command=>command.name==='GetChangeCommand').map(command=>command.status);
  assert.deepEqual(statuses,[...statuses.slice(0,-1).map(()=>'PENDING'),'INSYNC']);
}

test('emulator: a challenge TXT is published only after INSYNC, read back as one quoted value with TTL 60, and removed by its exact value',{skip},async t=>{
  const {dns,challenge,commands,records}=await hostedZone(t);
  await dns.present(challenge,tokenA);
  assertInsync(commands);
  assert.deepEqual(await records(challenge),[{Type:'TXT',TTL:60,ResourceRecords:[{Value:`"${tokenA}"`}]}]);

  commands.length=0;
  await dns.remove(challenge,tokenA);
  assert.deepEqual(commands.map(command=>command.name),['ChangeResourceRecordSetsCommand']);
  assert.deepEqual(await records(challenge),[]);
});

test('emulator: a remove with a stale value is refused and the newer challenge survives',{skip},async t=>{
  const {client,zoneId,dns,challenge,records}=await hostedZone(t);
  await dns.present(challenge,tokenA);
  await client.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId:zoneId,
    ChangeBatch:{Changes:[{Action:'UPSERT',ResourceRecordSet:{
      Name:challenge,Type:'TXT',TTL:60,ResourceRecords:[{Value:`"${tokenB}"`}],
    }}]},
  }));

  const error=t.mock.method(console,'error',()=>{});
  await assert.rejects(dns.remove(challenge,tokenA),{name:'InvalidChangeBatch'});
  assert.deepEqual(error.mock.calls.map(call=>call.arguments),[['remote.dns_cleanup_failed']]);
  assert.deepEqual(await records(challenge),[{Type:'TXT',TTL:60,ResourceRecords:[{Value:`"${tokenB}"`}]}]);
});

test('emulator: a venue CNAME is pointed at its cell with TTL 60 only after INSYNC',{skip},async t=>{
  const {dns,venue,commands,records}=await hostedZone(t);
  await dns.point(venue,'gw.cell-b.example.test');
  assertInsync(commands);
  assert.deepEqual(await records(venue),[{Type:'CNAME',TTL:60,ResourceRecords:[{Value:'gw.cell-b.example.test'}]}]);
});
