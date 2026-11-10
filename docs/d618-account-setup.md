# Prepare the practice account for one D618 run

The launcher needs four roles and a budget before it can create its three machines.
You do this setup once, as the account administrator; then run the experiment as
`d618-launcher`. Use the standalone practice account shown in your private desk note,
not an Organization member. Nothing here authorises a lane to access Amazon or spend.
These policies have offline checks only; complete the live checks below before launch.

## 1. Retire the expired identity, then prepare the files

Delete the 12 October identity **first**, if it still exists. In IAM → Users →
`waitron-lane-d-rehearsal`, deactivate and delete every access key, detach
`waitron-lane-d-rehearsal`, remove inline policies and its permissions boundary,
then delete the user. In IAM → Policies, delete `waitron-lane-d-rehearsal` and
`lane-d-boundary` only after **Entities attached = 0**; otherwise retain the shared
policy and inspect its users. Check the policy’s **Permissions boundary** usage too;
a boundary used by a retained role must stay. After revocation, use a local editor
to remove only the retired `waitron-rehearsal` profile from
`~/.config/waitron-cloud/aws/credentials` and the matching stanza in
`~/.config/waitron-cloud/aws/config`; preserve
other profiles. Check locally that both retired stanzas are gone, without printing
credentials. Do not delete buckets, keys or roles belonging to other
rehearsals. Check: the user search returns no match and neither policy has an
attachment to that user. Expiry on 3 November did not delete anything.

Keep your root MFA enabled. In IAM, use an existing non-root IAM user with MFA,
or create a console-only user `d618-owner-login` with MFA and no access keys.
As administrator, set its console password privately without requiring a first-login
reset, then register its MFA device under Security credentials.
Give this identity only `sts:AssumeRole` on the launcher role below, plus AWS's
`SignInLocalDevelopmentAccess` managed policy for browser-based CLI login.
Use your administrator session for setup, not this restricted identity.

In a clean Cloud checkout, set these values privately. `OWNER_PRINCIPAL_ARN` is the
IAM user ARN from IAM, never a root ARN or an STS session ARN. Choose an official
Debian 13 amd64 AMI in Ireland with root device `/dev/xvda`. Use the existing EC2 key
pair from the desk's `create-key-pair` step; do not create a second pair.

```sh
export ACCOUNT_ID=YOUR_PRACTICE_ACCOUNT_ID
export OWNER_PRINCIPAL_ARN=YOUR_NON_ROOT_IAM_ARN
export IMAGE_ID=YOUR_DEBIAN_13_AMI_ID
export KEY_NAME=YOUR_EXISTING_EC2_KEY_NAME
export D618_SETUP_DIR="$(mktemp -d "$HOME/.d618-setup.XXXXXX")"
python3 - <<'PY'
import json, os
from pathlib import Path
source = Path('deploy/kubernetes/bounded-amazon/setup')
for path in source.glob('*.json'):
    text = path.read_text()
    for key in ('ACCOUNT_ID', 'OWNER_PRINCIPAL_ARN', 'IMAGE_ID', 'KEY_NAME'):
        text = text.replace(key, os.environ[key])
    value = json.loads(text)
    target = Path(os.environ['D618_SETUP_DIR']) / path.name
    target.write_text(json.dumps(value, indent=2) + '\n')
    target.chmod(0o600)
print('Prepared policy files in the private setup directory')
PY
```

Check: open the rendered JSON locally; every account, AMI, key name and owner ARN
must be yours, with no placeholders left. Never paste credentials, account details
or command output into Git, a pull request or chat. Do not create or copy access keys.

## 2. Create the four roles

In IAM → Roles → Create role → Custom trust policy, paste the matching rendered
`*-trust.json`; create each role with the exact name below. Then Permissions →
Add permissions → Create inline policy → JSON: paste its `*-policy.json`, naming
the inline policy `d618`. Do not attach administrator or EC2-full-access policies.

| Role name | Trust file | Permissions file | Purpose |
| --- | --- | --- | --- |
| `d618-launcher` | `launcher-trust.json` | `launcher-policy.json` | Your CLI checks, create, stop C and delete |
| `d618-stack` | `stack-trust.json` | `stack-policy.json` | CloudFormation creates and deletes template resources |
| `d618-scheduler` | `scheduler-trust.json` | `scheduler-policy.json` | The expiry schedule deletes the stack |
| `d618-budget` | `budget-trust.json` | `budget-policy.json` | Budgets attaches/removes only the deny-launch policy |

You launch through a separate role so the budget restricts that role while your
owner sign-in can still assume it to inspect and delete.

For `d618-launcher`, set maximum session duration to **3 hours**. In the non-root
owner identity's Permissions → Add inline policy, paste the rendered
`owner-policy.json`. Check that a newly created user has only this inline policy and
`SignInLocalDevelopmentAccess`.

On the x86 test box use AWS CLI **2.32.0 or later**. Configure browser login and the
role profile (these settings contain no secret). CLI-managed session caches stay
private; never export credentials or put access keys in a file.

```sh
aws login --remote --profile d618-owner --region eu-west-1
aws configure set role_arn "arn:aws:iam::$ACCOUNT_ID:role/d618-launcher" --profile d618
aws configure set source_profile d618-owner --profile d618
aws configure set role_session_name d618-owner-run --profile d618
aws configure set duration_seconds 10800 --profile d618
aws configure set region eu-west-1 --profile d618
export AWS_PROFILE=d618
aws sts get-caller-identity
for ROLE in d618-launcher d618-stack d618-scheduler d618-budget; do
  aws iam get-role --role-name "$ROLE" --query 'Role.{Arn:Arn,Trust:AssumeRolePolicyDocument}'
done
```

Check: caller account matches your desk note, ARN contains `assumed-role/d618-launcher/`,
and the four trusts match the files. The profile requests three hours to match
the role setting; keep the source browser-login session available for CLI refreshes.
Do not start with a root identity or the old rehearsal profile.

## 3. Make the USD 10 budget deny new launches

As administrator, IAM → Policies → Create policy → JSON: paste `deny-launch.json`,
name it **d618-deny-launch**. Leave it unattached; Budgets attaches it at the threshold.
Billing → Budgets → Create budget → Customize → Cost budget: name **D618**, monthly,
fixed **USD 10**, all account costs, including tax, without service/tag filters.
At actual spend **100%**, add your own email as the alert recipient, then add an
automatic action: execution role **d618-budget**,
action **Apply IAM policy**, policy **d618-deny-launch**, target role
**d618-launcher**, automatically execute **Yes**. Review and create. Keep the action
ID from its detail page privately. An existing D618 budget must be edited to these
settings rather than duplicated. Enable Cost Explorer in Billing if not already enabled;
its first data can take 24 hours. No SCP or Organization setup is needed.

Check using the launcher profile:

```sh
aws budgets describe-budget --account-id "$ACCOUNT_ID" --budget-name D618
export ACTION=YOUR_ACTION_ID
aws budgets describe-budget-action --account-id "$ACCOUNT_ID" --budget-name D618 --action-id "$ACTION"
```

Require `BudgetLimit` 10 USD, `ActionType` APPLY_IAM_POLICY, ACTUAL at 100%,
`ApprovalModel` AUTOMATIC, execution role `d618-budget`, the exact deny policy and
only target role `d618-launcher`. If the action already executed or spend reached
USD 10, do not launch. Billing updates are delayed: this is a backstop, **not a hard
USD 10 ceiling**. It blocks later `CreateStack` calls, not an already accepted stack.
The independent 90-minute schedule and manual deletion remain essential.

## 4. Check permission boundaries before starting

Run these as `d618-launcher`. A simulation reads policy; it creates no resource.
The synthetic stack and instance identifiers below are for simulation only.

```sh
export CALLER_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-launcher"
export STACK_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-stack"
export SCHEDULER_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-scheduler"
export SIM_STACK="arn:aws:cloudformation:eu-west-1:$ACCOUNT_ID:stack/d618-simulation/example"
aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
  --action-names cloudformation:CreateStack --resource-arns "$SIM_STACK" \
  --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string \
  ContextKeyName=aws:RequestTag/cloud.campaign,ContextKeyValues=D618,ContextKeyType=string
aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
  --action-names iam:PassRole --resource-arns "$STACK_ROLE" \
  --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string
aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
  --action-names ec2:RunInstances iam:CreateRole --resource-arns '*'
aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
  --policy-input-list "$(cat "$D618_SETUP_DIR/deny-launch.json")" \
  --action-names cloudformation:CreateStack cloudformation:DeleteStack cloudformation:DescribeStacks \
  --resource-arns "$SIM_STACK" \
  --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string \
  ContextKeyName=aws:RequestTag/cloud.campaign,ContextKeyValues=D618,ContextKeyType=string
aws iam simulate-principal-policy --policy-source-arn "$SCHEDULER_ROLE" \
  --action-names cloudformation:DeleteStack --resource-arns "$SIM_STACK" \
  --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string
aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region eu-west-1
aws iam simulate-principal-policy --policy-source-arn "$SCHEDULER_ROLE" \
  --action-names iam:PassRole --resource-arns "$STACK_ROLE" \
  --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string
aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
  --action-names iam:PassRole --resource-arns "$SCHEDULER_ROLE" \
  --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=scheduler.amazonaws.com,ContextKeyType=string
aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
  --action-names ec2:TerminateInstances \
  --resource-arns "arn:aws:ec2:eu-west-1:$ACCOUNT_ID:instance/i-0123456789abcdef0" \
  --context-entries ContextKeyName=ec2:ResourceTag/aws:cloudformation:stack-name,ContextKeyValues=d618-simulation,ContextKeyType=string
aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
  --action-names ec2:TerminateInstances \
  --resource-arns "arn:aws:ec2:eu-west-1:$ACCOUNT_ID:instance/i-0123456789abcdef0" \
  --context-entries ContextKeyName=ec2:ResourceTag/aws:cloudformation:stack-name,ContextKeyValues=other-experiment,ContextKeyType=string
```

Require, in order: create allowed; passing the stack role allowed; direct EC2 launch
and role creation implicitly denied; with the budget denial, create explicitly denied
but describe/delete allowed; scheduler deletion allowed; the expected key pair found.
If a result has `MissingContextValues`, fix the invocation rather than reading it as
permission granted. The final four simulations must show both role passes allowed,
termination with the protected stack-name tag allowed, and termination with another
stack’s tag denied. CloudFormation sets `aws:` tags; [EC2 reserves that prefix](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html),
so the role cannot forge them with `CreateTags`.

Return to [the run checklist](aws-infrastructure.md#one-owner-started-amazon-experiment)
for quota, AMI, spend, config and launch. Confirm in the **account console** that the
practice account is standalone; `organizations:DescribeOrganization` is deliberately
not granted. No live experiment or permission enforcement is proved by this page.

## Why these actions are present

Every policy is derived from `scripts/amazon-run.mjs` and
`deploy/kubernetes/bounded-amazon/stack.yaml`; the following is the action map.
Resource IDs do not exist until creation, so their ARN suffixes use `*`. EC2 describe
calls, Cost Explorer and the quota read use `Resource: "*"`; no action uses `ec2:*`.
Network modifications/deletion and instance termination use CloudFormation’s protected
stack-name tag; stopping C uses the template’s explicit `cloud.campaign=D618` tag. Creation and
tagging cannot rely on a tag that does not exist yet. The role is for this isolated
practice account only; it is not a production deployment role.

| Policy section | Call or template resource requiring it |
| --- | --- |
| Owner AssumeRole | The browser-login identity assumes `d618-launcher`; the separate AWS sign-in policy permits CLI login |
| Launcher create/tag, describe/delete, pass-role | `startAmazon.create`, waiters and error/`stop` teardown; the launcher passes only the stack role |
| Launcher stop/describe EC2 | `stopWorker`, `waitStopped`, `checkStopped`; image/key/usage checks in the run checklist |
| Launcher budget, IAM, quota, cost reads | Steps 2–4 above and the run checklist; `GetCallerIdentity` needs no IAM grant |
| Stack network create/tag/configure/delete | `Vpc`, `Subnet` (DNS/public IP attributes), `Internet`, `Attachment`, `Routes`, `Route`, `Association`, `Firewall`, `Mesh`; ingress/egress rule handling and rollback |
| Stack EC2/SSM reads | Declared CloudFormation create/read/delete checks for those resources and A/B/C, including launch-template, VPC-encryption and VPN-gateway discovery and Systems Manager association reads; no Systems Manager write is granted |
| Stack RunInstances/CreateTags/TerminateInstances | A/B/C, pinned AMI and key, m7i.xlarge, automatic root volumes/network interfaces; deletion removes root disks |
| Stack scheduler lifecycle/pass-role | `Expiry`, created before A/B/C; scheduler uses default group and CloudFormation-generated `d618-*` name |
| Scheduler delete/pass-role | `Expiry.Target` names the stack and explicitly supplies `StackRole` |
| Budget attach/detach | Apply/revert only `d618-deny-launch` on `d618-launcher`; no budget permission to stop/delete machines or change the other roles |

The read permissions include the [resource handlers’ declared discovery calls](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/resource-type-schemas.html);
which optional calls the live handlers use remains unverified.

Sources checked 10 November 2026: AWS's [service-role guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/least-privilege-cloudformation/service-roles-for-cloudformation.html),
[EC2 action/resource reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ec2.html),
[Scheduler reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_scheduler.html),
[budget action setup](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html),
[budget role policies](https://docs.aws.amazon.com/cost-management/latest/userguide/billing-example-policies.html#billing-permissions-ref-attach-role),
and [CLI browser login](https://docs.aws.amazon.com/signin/latest/userguide/command-line-sign-in.html).
Live role assumption, CloudFormation tagging, rollback and independent deletion
remain checks for your practice-account run. If creation fails, keep the stack roles
until every stack resource has been deleted; inspect CloudFormation events as the
administrator rather than broadening the launcher permissions.
