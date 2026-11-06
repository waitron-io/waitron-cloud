import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const account = '462991287391', region = 'eu-north-1';
const refuse = () => { throw new Error('D570 controller refused'); };
const check = value => { if (!value) refuse(); };
const iso = instant => new Date(instant).toISOString().replace('.000Z', 'Z');
function instant(value) {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value));
  const result = Date.parse(value);
  check(Number.isFinite(result) && iso(result) === value);
  return result;
}

export function createManualAwsCli({ executable = 'aws' } = {}) {
  return { async call(service, operation, input) {
    check((service === 'sts' && operation === 'get-caller-identity')
      || (service === 'ce' && operation === 'get-cost-and-usage'));
    const payload = JSON.stringify(input);
    check(typeof payload === 'string' && Buffer.byteLength(payload) <= 64 * 1024);
    try {
      const { stdout } = await execute(executable, [service, operation, '--cli-input-json', payload,
        '--region', service === 'ce' ? 'us-east-1' : region, '--output', 'json', '--no-paginate', '--no-cli-pager',
        '--cli-connect-timeout', '5', '--cli-read-timeout', '15'], {
        timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, AWS_MAX_ATTEMPTS: '3', AWS_RETRY_MODE: 'standard',
          AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true', AWS_EC2_METADATA_DISABLED: 'true', AWS_PAGER: '' },
      });
      return JSON.parse(stdout);
    } catch { throw new Error(`D570 AWS ${service}/${operation} failed`); }
  } };
}

async function checkedMain(checkout) {
  const cwd = await realpath(checkout);
  async function git(...args) {
    try {
      const { stdout } = await execute('git', args, { cwd, encoding: 'utf8', timeout: 30_000,
        killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      return stdout.trim();
    } catch { refuse(); }
  }
  check(await realpath(await git('rev-parse', '--show-toplevel')) === cwd);
  check(await git('symbolic-ref', '--short', 'HEAD') === 'main');
  check(await git('status', '--porcelain=v1', '--untracked-files=all') === '');
  check(['https://github.com/waitron-io/waitron-cloud.git', 'git@github.com:waitron-io/waitron-cloud.git']
    .includes(await git('config', '--get', 'remote.origin.url')));
  const head = await git('rev-parse', 'HEAD'), tree = await git('rev-parse', 'HEAD^{tree}');
  check(/^[a-f0-9]{40}$/.test(head) && /^[a-f0-9]{40}$/.test(tree));
  check(await git('rev-parse', 'refs/remotes/origin/main') === head);
  check(await git('ls-remote', '--exit-code', 'origin', 'refs/heads/main') === `${head}\trefs/heads/main`);
  return { head, tree };
}

function billingObservation(response, period, now) {
  check(response && !response.NextPageToken && Array.isArray(response.GroupDefinitions)
    && response.GroupDefinitions.length === 0 && Array.isArray(response.ResultsByTime) && response.ResultsByTime.length === 1);
  const row = response.ResultsByTime[0], total = row?.Total?.UnblendedCost;
  check(row?.TimePeriod?.Start === period.Start && row.TimePeriod.End === period.End
    && typeof row.Estimated === 'boolean' && Array.isArray(row.Groups) && row.Groups.length === 0
    && total?.Unit === 'USD' && typeof total.Amount === 'string' && /^(0|[1-9]\d{0,9})(\.\d{1,10})?$/.test(total.Amount));
  const [whole, fraction = ''] = total.Amount.split('.');
  const nanos = BigInt(whole + fraction.padEnd(10, '0'));
  const microUsd = Number((nanos + 9999n) / 10000n);
  check(Number.isSafeInteger(microUsd) && microUsd < 10_000_000);
  // Current-month estimates do not establish reconciled billing or release cost ownership.
  return { observedAt: now, period, microUsd, estimated: row.Estimated };
}

export async function inspectManualControl({ checkout, region: requestedRegion, now, aws, environment = process.env, clock = Date.now }) {
  check(requestedRegion === region && !environment.GITHUB_ACTIONS && !environment.GITHUB_EVENT_NAME);
  const current = instant(now);
  check(current < Date.parse('2027-02-28T23:59:00Z') && typeof aws?.call === 'function');
  const fresh = () => {
    const at = clock();
    check(Number.isSafeInteger(at) && at >= current && at < Date.parse('2027-02-28T23:59:00Z')
      && iso(at).slice(0, 10) === now.slice(0, 10));
  };
  fresh();
  const source = await checkedMain(checkout);
  fresh();
  const identity = await aws.call('sts', 'get-caller-identity', {});
  check(identity?.Account === account && typeof identity.Arn === 'string'
    && /^arn:aws:sts::462991287391:assumed-role\/[\w+=,.@/-]+\/[\w+=,.@-]+$/.test(identity.Arn));
  fresh();
  check(JSON.stringify(await checkedMain(checkout)) === JSON.stringify(source));
  fresh();
  const period = { Start: now.slice(0, 7) + '-01', End: iso(current + 86400_000).slice(0, 10) };
  const response = await aws.call('ce', 'get-cost-and-usage', { TimePeriod: period, Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'], Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [account] } } });
  fresh();
  check(JSON.stringify(await checkedMain(checkout)) === JSON.stringify(source));
  fresh();
  return { account, region, ...source, billing: billingObservation(response, period, now) };
}

if (process.argv[1] && process.argv[1] !== '-' && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.error('D570 manual lifecycle is not implemented. No setup, launch, reconciliation or removal was performed.');
  process.exitCode = 1;
}
