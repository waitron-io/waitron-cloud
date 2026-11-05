import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url)));
const load = name => readFileSync(new URL(name, import.meta.url), 'utf8');

export function renderSetup({ account, region, repository, oidcProviderArn, image, s3PrefixListId, now }) {
  if (account !== policy.account || region !== policy.region) throw new Error('D570 scope refused');
  if (repository?.fullName !== policy.repository || repository.id !== policy.repositoryId || repository.ownerId !== policy.repositoryOwnerId || !Number.isSafeInteger(repository.id) || repository.id <= 0
    || !Number.isSafeInteger(repository.ownerId) || repository.ownerId <= 0) throw new Error('Repository identity refused');
  if (typeof now !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(now)
    || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now.replace('Z', '.000Z')
    || Date.parse(now) >= Date.parse(policy.accessExpiry)) throw new Error('D570 authority expired or invalid');
  if (oidcProviderArn !== null && oidcProviderArn !== `arn:aws:iam::${policy.account}:oidc-provider/token.actions.githubusercontent.com`) throw new Error('Foreign OIDC identity refused');
  if (!image || !/^ami-[0-9a-f]{17}$/.test(image.ImageId) || image.OwnerId !== policy.officialImageOwner
    || image.Architecture !== 'arm64' || image.State !== 'available' || image.Public !== true
    || image.RootDeviceType !== 'ebs' || image.VirtualizationType !== 'hvm') throw new Error('Unverified official ARM image');
  if (typeof s3PrefixListId !== 'string' || !/^pl-[0-9a-f]{8,17}$/.test(s3PrefixListId)) throw new Error('Invalid S3 prefix identity');
  const subject = `repo:${repository.fullName}:environment:${policy.environment}`;
  const substitutions = {
    D570_S3_PREFIX_LIST: s3PrefixListId, D570_OIDC_ARN: oidcProviderArn ?? '',
    D570_REPO_ID: String(repository.id), D570_OWNER_ID: String(repository.ownerId), D570_SUBJECT: subject,
  };
  const template = JSON.parse(load('./setup.yaml'), (key, value) => {
    if (typeof value !== 'string') return value;
    for (const [marker, replacement] of Object.entries(substitutions)) value = value.replaceAll(marker, replacement);
    return value;
  });
  template.Parameters.ImageId.Default = image.ImageId;
  template.Parameters.ImageId.AllowedValues = [image.ImageId];
  template.Resources.ExpiryFunction.Properties.Code.ZipFile = lambdaSource();
  return template;
}

function lambdaSource() {
  const engine = load('./expiry.mjs').replace('export async function sweepExpired', 'async function sweepExpired');
  return `${engine}\nconst ec2sdk = require('@aws-sdk/client-ec2');
const s3sdk = require('@aws-sdk/client-s3');
const ec2 = new ec2sdk.EC2Client({ region: process.env.AWS_REGION, maxAttempts: 3 });
const s3 = new s3sdk.S3Client({ region: process.env.AWS_REGION, maxAttempts: 3 });
const operations = { DescribeInstances: ec2sdk.DescribeInstancesCommand, DescribeVolumes: ec2sdk.DescribeVolumesCommand, TerminateInstances: ec2sdk.TerminateInstancesCommand, DeleteVolume: ec2sdk.DeleteVolumeCommand, PutObject: s3sdk.PutObjectCommand };
exports.handler = async () => sweepExpired({ account: process.env.ACCOUNT, region: process.env.AWS_REGION, stackId: process.env.STACK_ID, bucket: process.env.BUCKET, aws: { call: (service, operation, input) => (service === 'ec2' ? ec2 : s3).send(new operations[operation](input)) } });\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.error('D570 owner-run lifecycle is not implemented. Do not apply this prerequisite template; budget, bootstrap, repository protection and live safety qualification remain open.');
  process.exitCode = 1;
}
