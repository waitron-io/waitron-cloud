# Prepare the practice account for one D618 run

Work through these eight parts in order. Use the standalone practice account in
your private desk note. Setup creates four roles and a USD 10 budget backstop;
the experiment comes afterwards. The lane has no permission to access Amazon or spend.

## Which login, for which step

| Part | Window and login |
| --- | --- |
| 1. Remove the old login | Practice account's **root console**, with MFA; your local editor for the old profiles |
| 2. Create the new login | **Root console** |
| 3. Find the key pair and image | **Root console**, EC2 in **Ireland (`eu-west-1`)** |
| 4. Prepare the files | **x86 test box's terminal**, in your clean Waitron Cloud checkout |
| 5. Create four roles | **Root console**; terminal only to display the prepared files |
| 6. Set the budget | **Root console** |
| 7. Sign the CLI in | **x86 terminal** and a separate **`d618-owner-login` browser session** |
| 8. Check permissions | **x86 terminal**, using the **`d618` profile** |

Root is the account's original email login (see your private note), not an IAM
user. Keep that console separate from the new user's browser session. Use root
only for this one-time setup; [AWS recommends an administrative identity for
everyday work](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html).
Do not create root access keys or run the experiment as root.

## 1. Remove the old login

**Window: practice account's root console.** Skip anything already removed.

1. Open **IAM → Users → `waitron-lane-d-rehearsal` → Security credentials**.
2. Deactivate each old access key.
3. Delete each deactivated access key.
4. Open that user's **Permissions** tab.
5. Detach the `waitron-lane-d-rehearsal` policy.
6. Delete the user's inline policies.
7. Remove its permissions boundary.
8. Delete the user.
9. Open **IAM → Policies → `waitron-lane-d-rehearsal`**.
10. Delete that policy only if both **Entities attached** and **Permissions boundary** usage are zero.
11. Do the same check for `lane-d-boundary` if it still exists. Retain any policy used by another identity.

**Window: your local editor.**

1. Remove only the retired `waitron-rehearsal` stanza from `~/.config/waitron-cloud/aws/credentials`.
2. Remove its matching stanza from `~/.config/waitron-cloud/aws/config`.
3. Check locally that both stanzas are gone, without printing credentials.

You do not need `waitron-billing-read` or `lane-d-boundary` for D618. If you already
deleted them, do not recreate them. Leave other rehearsals' buckets, keys and roles alone.

## 2. Create the new console login

**Window: practice account's root console.** Keep root MFA enabled.

1. Open **IAM → Users → Create user**.
2. Enter **`d618-owner-login`** as the user name.
3. Enable **AWS Management Console access** for this IAM user.
4. Set its password privately, without requiring a first-login password reset.
5. Finish creating the user without granting administrator permissions.
6. Open **`d618-owner-login` → Security credentials → Assign MFA device**.
7. Register your MFA device.
8. Copy this user's **ARN** from its summary into your private notes. You need it in part 4.

Create no access key. Part 5 gives this user its two permissions.

## 3. Find the existing key pair and Debian image

**Window: root console, region set to Ireland (`eu-west-1`).** These are lookups;
do not launch an instance or create another key pair.

1. Open **EC2 → Network & Security → Key pairs**.
2. Find the key pair from the desk's earlier `create-key-pair` step.
3. Copy its **Key pair name** into your private notes. This is `KEY_NAME`, not the `.pem` filename.
4. Open **EC2 → Images → AMIs**.
5. Change **Owned by me** to **Public images**.
6. Filter **Owner** to **`136693071363`**.
7. Search the image name for **`debian-13-amd64-`**.
8. Select the newest available matching image.
9. Check its details: owner **`136693071363`**, architecture **`x86_64`**, root device **`/dev/xvda`**.
10. Copy its **AMI ID** into your private notes as `IMAGE_ID`.

Debian's [official Debian 13 cloud-image page](https://wiki.debian.org/Cloud/AmazonEC2Image/Trixie)
states: “The AMIs are owned by AWS account ID `136693071363`”. That is Debian's
public publisher ID, not your account ID. The name uses `amd64`; EC2 calls that
architecture `x86_64`. Part 8 includes the equivalent CLI lookup after login is ready.

## 4. Prepare the policy files

**Window: x86 test box's terminal, inside your clean Waitron Cloud checkout.**
Keep this terminal open through part 8. Replace each `YOUR_…` value privately.

1. Set the practice account ID from your private note:

   ```sh
   export ACCOUNT_ID=YOUR_PRACTICE_ACCOUNT_ID
   ```

2. Set the IAM user ARN copied in part 2 (never root or an assumed-role ARN):

   ```sh
   export OWNER_PRINCIPAL_ARN=YOUR_D618_OWNER_LOGIN_IAM_ARN
   ```

3. Set the AMI ID copied in part 3:

   ```sh
   export IMAGE_ID=YOUR_DEBIAN_13_AMI_ID
   ```

4. Set the key pair name copied in part 3:

   ```sh
   export KEY_NAME=YOUR_EXISTING_EC2_KEY_NAME
   ```

5. Make a private directory for the rendered files:

   ```sh
   export D618_SETUP_DIR="$(mktemp -d "$HOME/.d618-setup.XXXXXX")"
   ```

6. Render the policy files into that directory:

   ```sh
   python3 - <<'PYTHON'
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
   PYTHON
   ```

7. Inspect those files locally: your four values must be correct, with no `YOUR_…`, `ACCOUNT_ID`, `OWNER_PRINCIPAL_ARN`, `IMAGE_ID` or `KEY_NAME` placeholders left.

Do not paste account details, credentials or command output into Git, a pull request
or chat. These files contain permission settings; do not copy access keys into them.

## 5. Create the four roles

**Window: root console.** Use the x86 terminal only to display each file for copying.

For **each row** in this table, repeat the numbered steps below:

| Role name | Trust file | Permissions file |
| --- | --- | --- |
| `d618-launcher` | `launcher-trust.json` | `launcher-policy.json` |
| `d618-stack` | `stack-trust.json` | `stack-policy.json` |
| `d618-scheduler` | `scheduler-trust.json` | `scheduler-policy.json` |
| `d618-budget` | `budget-trust.json` | `budget-policy.json` |

1. In the terminal, display that row's trust file (replace `launcher` with the row's file prefix):

   ```sh
   cat "$D618_SETUP_DIR/launcher-trust.json"
   ```

2. In the console, open **IAM → Roles → Create role → Custom trust policy**.
3. Paste the displayed JSON into the trust editor.
4. Continue without adding a managed permissions policy.
5. Enter the exact role name from the table.
6. Create the role.
7. In the terminal, display that row's permissions file:

   ```sh
   cat "$D618_SETUP_DIR/launcher-policy.json"
   ```

8. In the new role, open **Permissions → Add permissions → Create inline policy → JSON**.
9. Paste the displayed permissions JSON.
10. Name the inline policy **`d618`**.
11. Create the inline policy.

After all four roles exist:

1. Open **IAM → Roles → `d618-launcher` → Edit** beside **Maximum session duration**.
2. Set its maximum session duration to **3 hours**.
3. Display the owner policy in the terminal:

   ```sh
   cat "$D618_SETUP_DIR/owner-policy.json"
   ```

4. Open **IAM → Users → `d618-owner-login` → Permissions → Add permissions → Create inline policy → JSON**.
5. Paste the owner policy JSON.
6. Name and create that inline policy as **`d618`**.
7. Open **Add permissions → Attach policies directly** for that user.
8. Attach AWS's **`SignInLocalDevelopmentAccess`** managed policy.
9. Check the user has only that managed policy and the `d618` inline policy.

The launcher is separate so the budget can block its new launches while your owner
sign-in can still assume it to inspect and delete. Do not add administrator or EC2-full-access policies.

## 6. Set the USD 10 budget backstop

**Window: root console.** Edit an existing **D618** budget rather than making a duplicate.

1. Display the deny policy in the x86 terminal:

   ```sh
   cat "$D618_SETUP_DIR/deny-launch.json"
   ```

2. Open **IAM → Policies → Create policy → JSON** in the console.
3. Paste that JSON.
4. Name and create the policy as **`d618-deny-launch`**. Leave it unattached.
5. Open **Billing and Cost Management → Budgets → Create budget → Customize → Cost budget**.
6. Set the budget name to **D618**.
7. Set its period to **Monthly**.
8. Set a fixed limit of **USD 10**.
9. Include **all account costs, including tax**, without service or tag filters.
10. Add an alert at **100% of actual spend**.
11. Set your own email as its recipient.
12. Add an **automatic action** to that alert.
13. Select execution role **`d618-budget`**.
14. Select **Apply IAM policy** as the action.
15. Select policy **`d618-deny-launch`**.
16. Select only role **`d618-launcher`** as its target.
17. Set automatic execution to **Yes**.
18. Review and create the budget/action.
19. Copy the **action ID** from its detail page into your private notes.
20. Enable **Cost Explorer** in Billing if it is not already enabled. First data can take 24 hours.

Billing updates are delayed: this is a backstop, **not a hard USD 10 ceiling**.
It blocks later `CreateStack` calls, not an accepted stack. The independent
90-minute deletion schedule and manual deletion remain essential.

## 7. Sign the CLI in as the new user

**Windows: x86 terminal and a separate browser session signed in as `d618-owner-login`.**
Keep the root setup console separate. Check the browser's selected identity before authorising CLI login.

1. Check the CLI version; it must be **2.32.0 or later**:

   ```sh
   aws --version
   ```

2. Start browser login from the terminal:

   ```sh
   aws login --remote --profile d618-owner --region eu-west-1
   ```

3. Complete the displayed browser instructions as **`d618-owner-login`**, not root.
4. Set the role used by the run:

   ```sh
   aws configure set role_arn "arn:aws:iam::$ACCOUNT_ID:role/d618-launcher" --profile d618
   ```

5. Set the source login:

   ```sh
   aws configure set source_profile d618-owner --profile d618
   ```

6. Set the session name:

   ```sh
   aws configure set role_session_name d618-owner-run --profile d618
   ```

7. Set the requested duration to three hours:

   ```sh
   aws configure set duration_seconds 10800 --profile d618
   ```

8. Set the region:

   ```sh
   aws configure set region eu-west-1 --profile d618
   ```

9. Select that profile for the remaining commands:

   ```sh
   export AWS_PROFILE=d618
   ```

10. Check who the CLI is using:

    ```sh
    aws sts get-caller-identity
    ```

Continue only if the account matches your private note and the ARN contains
**`assumed-role/d618-launcher/`**. Keep the source browser-login session available
for refreshes. CLI-managed caches stay private; do not export credentials or write access keys to files.

## 8. Check the setup before launching

**Window: x86 terminal, `AWS_PROFILE=d618`.** These checks do not launch machines.
Policy simulation reads the settings; it does not prove live enforcement.

1. Read back the four role trusts and compare them with your rendered files:

   ```sh
   for ROLE in d618-launcher d618-stack d618-scheduler d618-budget; do
     aws iam get-role --role-name "$ROLE" --query 'Role.{Arn:Arn,Trust:AssumeRolePolicyDocument}'
   done
   ```

2. Check that the selected key pair exists in Ireland:

   ```sh
   aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region eu-west-1
   ```

3. List the official Debian 13 amd64 images in Ireland, newest first:

   ```sh
   aws ec2 describe-images --region eu-west-1 --owners 136693071363 \
     --filters 'Name=name,Values=debian-13-amd64-*' \
       'Name=architecture,Values=x86_64' 'Name=state,Values=available' \
       'Name=root-device-name,Values=/dev/xvda' \
     --query 'reverse(sort_by(Images, &CreationDate))[].[ImageId,Name,OwnerId,RootDeviceName]' \
     --output table
   ```

4. Confirm your selected `IMAGE_ID` is in that official list (do not silently change it after creating the policies).
5. Read the budget:

   ```sh
   aws budgets describe-budget --account-id "$ACCOUNT_ID" --budget-name D618
   ```

6. Set the action ID you noted in part 6:

   ```sh
   export ACTION=YOUR_ACTION_ID
   ```

7. Read the budget action:

   ```sh
   aws budgets describe-budget-action --account-id "$ACCOUNT_ID" --budget-name D618 --action-id "$ACTION"
   ```

Require **10 USD**, **APPLY_IAM_POLICY**, **ACTUAL at 100%**, **AUTOMATIC**,
execution role **`d618-budget`**, policy **`d618-deny-launch`**, and only target role
**`d618-launcher`**. Do not launch if the action has executed or spend has reached USD 10.

### Check each permission separately

**Window: the same x86 terminal, `AWS_PROFILE=d618`.** The stack and instance IDs
below are synthetic simulation inputs.

1. Set the simulation names:

   ```sh
   export CALLER_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-launcher"
   export STACK_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-stack"
   export SCHEDULER_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-scheduler"
   export SIM_STACK="arn:aws:cloudformation:eu-west-1:$ACCOUNT_ID:stack/d618-simulation/example"
   ```

2. Check the launcher can create its tagged stack with the stack role. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --action-names cloudformation:CreateStack --resource-arns "$SIM_STACK" \
     --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string \
     ContextKeyName=aws:RequestTag/cloud.campaign,ContextKeyValues=D618,ContextKeyType=string
   ```

3. Check the launcher can pass that role to CloudFormation. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --action-names iam:PassRole --resource-arns "$STACK_ROLE" \
     --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string
   ```

4. Check direct instance launch and role creation. Expect **implicitDeny** for both:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --action-names ec2:RunInstances iam:CreateRole --resource-arns '*'
   ```

5. Add the budget denial in simulation. Expect create **explicitDeny**, describe/delete **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --policy-input-list "$(cat "$D618_SETUP_DIR/deny-launch.json")" \
     --action-names cloudformation:CreateStack cloudformation:DeleteStack cloudformation:DescribeStacks \
     --resource-arns "$SIM_STACK" \
     --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string \
     ContextKeyName=aws:RequestTag/cloud.campaign,ContextKeyValues=D618,ContextKeyType=string
   ```

6. Check the scheduler can delete the stack. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$SCHEDULER_ROLE" \
     --action-names cloudformation:DeleteStack --resource-arns "$SIM_STACK" \
     --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string
   ```

7. Check the scheduler can pass the stack role to CloudFormation. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$SCHEDULER_ROLE" \
     --action-names iam:PassRole --resource-arns "$STACK_ROLE" \
     --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string
   ```

8. Check the stack can pass the scheduler role to Scheduler. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
     --action-names iam:PassRole --resource-arns "$SCHEDULER_ROLE" \
     --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=scheduler.amazonaws.com,ContextKeyType=string
   ```

9. Check deletion with D618's protected stack-name tag. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
     --action-names ec2:TerminateInstances \
     --resource-arns "arn:aws:ec2:eu-west-1:$ACCOUNT_ID:instance/i-0123456789abcdef0" \
     --context-entries ContextKeyName=ec2:ResourceTag/aws:cloudformation:stack-name,ContextKeyValues=d618-simulation,ContextKeyType=string
   ```

10. Repeat with another stack's tag. Expect **implicitDeny**:

    ```sh
    aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
      --action-names ec2:TerminateInstances \
      --resource-arns "arn:aws:ec2:eu-west-1:$ACCOUNT_ID:instance/i-0123456789abcdef0" \
      --context-entries ContextKeyName=ec2:ResourceTag/aws:cloudformation:stack-name,ContextKeyValues=other-experiment,ContextKeyType=string
    ```

If any result has **MissingContextValues**, fix that invocation before proceeding.
CloudFormation sets the protected `aws:` tags; [EC2 reserves that
prefix](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html), so
`CreateTags` cannot forge them.

Return to [the run checklist](aws-infrastructure.md#one-owner-started-amazon-experiment)
for quota, spend, config and launch. Confirm in the **account console** that this is
a standalone account; the launcher deliberately lacks `organizations:DescribeOrganization`.
This page's checks are offline/source guidance until you execute them; no live
permission enforcement or experiment is proved here.

## Policy reference

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
| Launcher budget, IAM, quota, cost reads | Parts 5–8 above and the run checklist; `GetCallerIdentity` needs no IAM grant |
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
