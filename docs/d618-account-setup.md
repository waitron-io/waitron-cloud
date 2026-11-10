# Prepare the practice account for one D618 run

Tonight's route uses one access key on **`d618-owner-login`**, only to assume
**`d618-launcher`**. You chose this one-run exception on 10 November. The key
has no automatic expiry: delete it after the run, including if the run fails.
The lane has no permission to access Amazon or spend.

**Use Stockholm (`eu-north-1`) for tonight's run**, as you chose on 10 November.
New-experience projects have a fixed region. Keep that region for the policies,
image, key pair and CLI profile; you do not need to activate advanced features.
The launcher requires an explicit region and has no default.

## Which login, for which step

| Part | Window and login |
| --- | --- |
| 1. Remove the old login | Your existing **project owner/setup console**; local editor for old profiles |
| 2. Prepare the IAM user | **Project owner/setup console** |
| 3. Find or create the SSH key; find the image | **Project owner/setup console**, EC2 in **Stockholm (`eu-north-1`)** |
| 4. Prepare the files | **x86 test box's terminal**, in your clean Waitron Cloud checkout |
| 5. Create four roles | **Project owner/setup console**; terminal to display the files |
| 6. Set the budget | **Project owner/setup console** |
| 7. Configure tonight's access key | **Project owner/setup console**, then **x86 terminal** |
| 8. Check permissions, run, remove the key | **x86 terminal**, using **`d618`**; setup console for key deletion |

The new account uses a project owner identity, not a root console login. Do not
create an IAM console password, invite a teammate, or activate advanced features
for tonight's credential setup. AWS's [account comparison](https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html)
explains project ownership; its [IAM guide](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html)
says “you cannot create IAM users with console access” in the new experience.

## Before part 1: get the current files

In the x86 test box's terminal, open your existing **Waitron Cloud checkout on
`main`**. Replace the example path with that checkout's path, then run:

```sh
cd /absolute/path/to/waitron-cloud
git pull --ff-only
git log -1 --oneline
```

Check that the latest commit is **`9307c90ce` or later**. Keep this terminal in
that folder: every relative file path below starts from this checkout.

## 1. Remove the old login

**Window: project owner/setup console.** Skip anything already removed.

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

## 2. Prepare the IAM user for tonight's route

**Window: your existing project owner/setup console.**

1. Open **IAM → Users → `d618-owner-login`**.
2. If it does not exist, choose **Create user**, enter **`d618-owner-login`**,
   and finish without adding administrator permissions or console access.
3. Copy its **ARN** from the summary into your private notes for part 4.
4. Leave access-key creation until part 7, after the region and roles are checked.

This is an API-only user. Missing **Console sign-in** and IAM MFA controls are not
steps to work around. Part 5 grants only permission to assume the launcher;
keep your existing project owner session for setup and later key deletion.

## 3. Find or create the key pair, then find the Debian image

**Window: your project owner/setup console.** First check the region.

1. Open **AWS Settings → Project → Overview → Additional Info**.
2. Read **Region**. AWS documents this lookup in
   [project regions](https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html).
3. For tonight's run, require **Stockholm (`eu-north-1`)**. If the project shows
   another region, stop and check it before rendering policies.
4. Open [EC2 in Stockholm](https://eu-north-1.console.aws.amazon.com/ec2/home?region=eu-north-1).
5. Confirm the address bar contains **`eu-north-1`**. The AMI, key pair, policy
   resources and run profile must all use this region.

**Window: EC2 in Stockholm.** Do not launch an instance.

1. Open **EC2 → Network & Security → Key pairs**.
2. Look for a key pair whose private key you already hold.
3. If one exists, copy its **Key pair name** into your private notes as `KEY_NAME`.

If there is no usable key pair:

1. Choose **Create key pair**.
2. Enter **`d618`** for **Name**.
3. Choose **ED25519** for **Key pair type**.
4. Choose **.pem** for **Private key file format**.
5. Choose **Create key pair** and save the downloaded `d618.pem` privately.
6. Note **`d618`** as `KEY_NAME`; the key name is not the `.pem` filename.

AWS's [key-pair guide](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/create-key-pairs.html)
says “For Key pair type, choose either RSA or ED25519” for Linux instances.
D618 passes the key name to EC2 and the private-key path to OpenSSH's `ssh` and
`scp` (`scripts/amazon-run.mjs:116–118`); it has no RSA-only key parser.
Debian 13 is Linux. This is documented compatibility, not a live AMI connection test.

**Window: your Mac's terminal.** If you downloaded the key on the Mac, protect it
and copy it over your existing SSH connection to the x86 test box. Replace
`YOUR_TEST_BOX_SSH_LOGIN` with that connection's `user@host`; create no new login.

1. Protect the downloaded file:

   ```sh
   chmod 600 ~/Downloads/d618.pem
   ```

2. Copy it to a private file on the box without replacing an existing key:

   ```sh
   ssh YOUR_TEST_BOX_SSH_LOGIN 'umask 077; mkdir -p ~/.ssh; set -C; cat > ~/.ssh/d618.pem' < ~/Downloads/d618.pem
   ```

**Window: x86 test box's terminal.**

1. Set its permissions:

   ```sh
   chmod 600 ~/.ssh/d618.pem
   ```

2. Use the full absolute path to this file for the run configuration's **`sshKey`**.
   Keep it private and out of the checkout.

**Window: practice-account setup console, still in Stockholm.**

1. Open **EC2 → Images → AMI Catalog → Community AMIs**.
2. Search for **`debian-13-amd64-`**.
3. Check the publisher's **Owner ID** is **`136693071363`**.
4. Select the newest available matching image from that publisher.
5. Check its details: architecture **`x86_64`**, root device **`/dev/xvda`**.
6. Copy its **AMI ID** into your private notes as `IMAGE_ID`.

If you use **EC2 → Images → AMIs** instead, select **Public images**, filter
**Owner** to **`136693071363`**, and search for the same name.

Debian's [official Debian 13 cloud-image page](https://wiki.debian.org/Cloud/AmazonEC2Image/Trixie)
states: “The AMIs are owned by AWS account ID `136693071363`”. That is Debian's
public publisher ID, not your account ID. On 10 November 2026 its Stockholm amd64
image is **`ami-0d2679679834750c7`**. Use key pair **`d618`** in that same region.
Check the current table and CLI lookup before using an image. The name uses `amd64`; EC2 calls that
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

4. Set the key pair name copied or created in part 3:

   ```sh
   export KEY_NAME=YOUR_EXISTING_EC2_KEY_NAME
   ```

5. Select tonight's region explicitly, then make a private directory for the rendered files:

   ```sh
   export REGION=eu-north-1
   ```

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
       for key in ('ACCOUNT_ID', 'OWNER_PRINCIPAL_ARN', 'IMAGE_ID', 'KEY_NAME', 'REGION'):
           text = text.replace(key, os.environ[key])
       value = json.loads(text)
       target = Path(os.environ['D618_SETUP_DIR']) / path.name
       target.write_text(json.dumps(value, indent=2) + '\n')
       target.chmod(0o600)
   print('Prepared policy files in the private setup directory')
   PYTHON
   ```

7. Inspect those files locally: your five values must be correct, with no `YOUR_…`, `ACCOUNT_ID`, `OWNER_PRINCIPAL_ARN`, `IMAGE_ID`, `KEY_NAME` or `REGION` placeholders left. All regional ARNs and `aws:RequestedRegion` conditions must say `eu-north-1`.

Do not paste account details, credentials or command output into Git, a pull request
or chat. These files contain permission settings; do not copy access keys into them.

## 5. Create or update the four roles

**Window: project owner/setup console.** Use the x86 terminal only to display each file for copying.

If the roles already exist, use **Update existing roles** below. Otherwise, for
**each row** in this table, repeat the numbered steps below:

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

### Update existing roles for Stockholm

Render part 4 again with **`REGION=eu-north-1`**, Stockholm's image and key pair
**`d618`**. Keep the same account and exact owner IAM user ARN. Replace these
existing inline policies rather than adding another policy alongside Ireland's:

| Console role | Existing inline policy | Replace its entire JSON with |
| --- | --- | --- |
| `d618-launcher` | `d618` | `launcher-policy.json` |
| `d618-stack` | `d618` | `stack-policy.json` |
| `d618-scheduler` | `d618` | `scheduler-policy.json` |

1. Display the rendered file, for example `cat "$D618_SETUP_DIR/launcher-policy.json"`.
2. Open **IAM → Roles → the row's role → Permissions → expand `d618` → Edit policy → JSON**.
3. Select all the existing JSON and paste the rendered file's complete contents.
4. Choose **Next**, then **Save changes** (or **Review policy → Save changes**).
5. Repeat for the other two rows. Check each saved regional ARN and region condition
   says **`eu-north-1`**, with the correct account, image and key.
6. Display `cat "$D618_SETUP_DIR/scheduler-trust.json"`.
7. Open **IAM → Roles → `d618-scheduler` → Trust relationships → Edit trust policy**.
8. Replace all JSON with that rendered file and choose **Update policy**. Require
   **`arn:aws:scheduler:eu-north-1:YOUR_PRACTICE_ACCOUNT_ID:schedule-group/default`**
   for `aws:SourceArn`, with your actual account ID in place of the placeholder.

The other trust documents, owner policy, budget role and deny-launch policy have
no region and need no replacement. Do not change their principals or permissions.
AWS documents [editing inline policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_manage-edit-console.html)
and [updating role trust](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_update-role-trust-policy.html).

After creating or updating all four roles:

1. Open **IAM → Roles → `d618-launcher` → Edit** beside **Maximum session duration**.
2. Set its maximum session duration to **3 hours**, then save the change.
   Return to the role’s **Summary** panel and check **Maximum session duration**
   shows **3 hours** before continuing.
3. Display the owner policy in the terminal:

   ```sh
   cat "$D618_SETUP_DIR/owner-policy.json"
   ```

4. Open **IAM → Users → `d618-owner-login` → Permissions → Add permissions → Create inline policy → JSON**.
5. Paste the owner policy JSON.
6. Name and create that inline policy as **`d618`**.
7. Check the user has the `d618` inline policy and no administrator policy.

`SignInLocalDevelopmentAccess` is for browser CLI login; tonight's API-key route
does not need it. The owner policy and launcher trust already allow the exact
IAM user to assume `d618-launcher`; no policy template needs to change.
The trust has no IAM MFA condition: your project-owner MFA does not protect
an API call signed with this user's key.

The launcher is separate so the budget can block its new launches while your owner
sign-in can still assume it to inspect and delete. Do not add administrator or EC2-full-access policies.

## 6. Set the USD 10 budget backstop

**Window: project owner/setup console.** Edit an existing **D618** budget rather than making a duplicate.

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

## 7. Configure tonight's access key

**Window: project owner/setup console.** Check part 3's region gate first.

1. Open **IAM → Users → `d618-owner-login` → Security credentials**.
2. Under **Access keys**, choose **Create access key**.
3. Choose **Command Line Interface (CLI)** and read the alternative-credentials
   recommendation. Acknowledge it if the wizard asks, then choose **Next**.
   If the wizard only offers **Other**, use that after reading the recommendation.
4. Add **`D618 tonight`** as the optional description.
5. Choose **Create access key**.
6. Keep the access key ID and secret private; leave this page open while configuring
   the box. Save no copy in the checkout, a command, shell history or chat.

AWS's [CLI guide](https://docs.aws.amazon.com/cli/latest/userguide/cli-authentication-user.html)
says “choose Command Line Interface (CLI)” and recommends federation for regular
software development or real data. This is your one-run exception, with manual
key deletion at the end, not an automatically expiring key.

**Window: x86 test box's terminal.**

1. Enter the source credentials interactively:

   ```sh
   aws configure --profile d618-owner
   ```

2. At its prompts enter the key ID, secret, region **`eu-north-1`**, output **`json`**.
3. Protect the credentials file:

   ```sh
   chmod 600 ~/.aws/credentials
   ```

4. In **`~/.aws/config`**, add or update only this stanza. Replace
   **`YOUR_PRACTICE_ACCOUNT_ID`** privately; preserve every other profile:

   ```ini
   [profile d618]
   source_profile = d618-owner
   role_arn = arn:aws:iam::YOUR_PRACTICE_ACCOUNT_ID:role/d618-launcher
   role_session_name = d618-owner-run
   region = eu-north-1
   duration_seconds = 10800
   ```

5. Check the run identity:

   ```sh
   aws sts get-caller-identity --profile d618
   ```

6. Require your practice account ID and an ARN containing
   **`assumed-role/d618-launcher/`**. If it shows the IAM user or another role, stop.
7. Select the launcher for the remaining checks and the run:

   ```sh
   export AWS_PROFILE=d618
   ```

The user ARN in **`OWNER_PRINCIPAL_ARN`** remains the `d618-owner-login` IAM
**user's** ARN, not root, a project identity or an assumed-role session.
The direct IAM source can request three hours because part 5 sets that maximum
on the launcher; see [STS session durations](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html).
Never launch with `--profile d618-owner`.

## 8. Check the setup before launching

**Window: x86 terminal, `AWS_PROFILE=d618`.** These checks do not launch machines.
Policy simulation reads the settings; it does not prove live enforcement.

1. Read back the four role trusts and compare them with your rendered files:

   ```sh
   for ROLE in d618-launcher d618-stack d618-scheduler d618-budget; do
     aws iam get-role --role-name "$ROLE" --query 'Role.{Arn:Arn,Trust:AssumeRolePolicyDocument}'
   done
   ```

2. Check that the selected key pair exists in Stockholm:

   ```sh
   aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION"
   ```

3. List the official Debian 13 amd64 images in Stockholm, newest first:

   ```sh
   aws ec2 describe-images --region "$REGION" --owners 136693071363 \
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
below are synthetic simulation inputs. Each simulation supplies `aws:RequestedRegion`
so the project’s region guard evaluates your chosen region instead of refusing
a request with no region.

1. Set the simulation names:

   ```sh
   export CALLER_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-launcher"
   export STACK_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-stack"
   export SCHEDULER_ROLE="arn:aws:iam::$ACCOUNT_ID:role/d618-scheduler"
   export SIM_STACK="arn:aws:cloudformation:$REGION:$ACCOUNT_ID:stack/d618-simulation/example"
   ```

2. Check the launcher can create its tagged stack with the stack role. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --action-names cloudformation:CreateStack --resource-arns "$SIM_STACK" \
     --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string \
     ContextKeyName=aws:RequestTag/cloud.campaign,ContextKeyValues=D618,ContextKeyType=string \
     ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

3. Check the launcher can pass that role to CloudFormation. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --action-names iam:PassRole --resource-arns "$STACK_ROLE" \
     --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string \
     ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

4. Check direct instance launch and role creation. Expect **implicitDeny** for both.
   The project’s region guard does not apply to the global `iam:CreateRole` action:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --action-names ec2:RunInstances iam:CreateRole --resource-arns '*' \
     --context-entries ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

5. Add the budget denial in simulation. Expect create **explicitDeny**, describe/delete **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$CALLER_ROLE" \
     --policy-input-list "$(cat "$D618_SETUP_DIR/deny-launch.json")" \
     --action-names cloudformation:CreateStack cloudformation:DeleteStack cloudformation:DescribeStacks \
     --resource-arns "$SIM_STACK" \
     --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string \
     ContextKeyName=aws:RequestTag/cloud.campaign,ContextKeyValues=D618,ContextKeyType=string \
     ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

6. Check the scheduler can delete the stack. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$SCHEDULER_ROLE" \
     --action-names cloudformation:DeleteStack --resource-arns "$SIM_STACK" \
     --context-entries ContextKeyName=cloudformation:RoleArn,ContextKeyValues="$STACK_ROLE",ContextKeyType=string \
     ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

7. Check the scheduler can pass the stack role to CloudFormation. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$SCHEDULER_ROLE" \
     --action-names iam:PassRole --resource-arns "$STACK_ROLE" \
     --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=cloudformation.amazonaws.com,ContextKeyType=string \
     ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

8. Check the stack can pass the scheduler role to Scheduler. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
     --action-names iam:PassRole --resource-arns "$SCHEDULER_ROLE" \
     --context-entries ContextKeyName=iam:PassedToService,ContextKeyValues=scheduler.amazonaws.com,ContextKeyType=string \
     ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

9. Check deletion with D618's protected stack-name tag. Expect **allowed**:

   ```sh
   aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
     --action-names ec2:TerminateInstances \
     --resource-arns "arn:aws:ec2:$REGION:$ACCOUNT_ID:instance/i-0123456789abcdef0" \
     --context-entries ContextKeyName=ec2:ResourceTag/aws:cloudformation:stack-name,ContextKeyValues=d618-simulation,ContextKeyType=string \
     ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
   ```

10. Repeat with another stack's tag. Expect **implicitDeny**:

    ```sh
    aws iam simulate-principal-policy --policy-source-arn "$STACK_ROLE" \
      --action-names ec2:TerminateInstances \
      --resource-arns "arn:aws:ec2:$REGION:$ACCOUNT_ID:instance/i-0123456789abcdef0" \
      --context-entries ContextKeyName=ec2:ResourceTag/aws:cloudformation:stack-name,ContextKeyValues=other-experiment,ContextKeyType=string \
      ContextKeyName=aws:RequestedRegion,ContextKeyValues="$REGION",ContextKeyType=string
    ```

If any result has **MissingContextValues**, fix that invocation before proceeding.
CloudFormation sets the protected `aws:` tags; [EC2 reserves that
prefix](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html), so
`CreateTags` cannot forge them.

Return to [the run checklist](aws-infrastructure.md#one-owner-started-amazon-experiment)
for quota, spend, config and launch. Keep Stockholm in the config and profile;
the launcher deliberately lacks `organizations:DescribeOrganization`.
This page's checks are offline/source guidance until you execute them; no live
permission enforcement or experiment is proved here.

### Last step: delete tonight's access key

Do this after success **or failure**. First use the launcher to inspect/delete
any remaining D618 stack, as the run checklist directs.

**Window: your existing project owner/setup console.** The API user and launcher
cannot delete this key: neither policy grants **`iam:DeleteAccessKey`**.
AWS documents the required separate permissions in
[managing your own keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-key-self-managed.html).

1. Open **IAM → Users → `d618-owner-login` → Security credentials → Access keys**.
2. Select the one key created for tonight.
3. Choose **Actions → Deactivate** and confirm.
4. Choose **Actions → Delete** and confirm the requested key ID.
5. Refresh and require **Access keys (0)** / **No access keys**.
6. In the x86 box's private **`~/.aws/credentials`**, remove only the
   **`[d618-owner]`** stanza. Preserve every other profile.
7. Delete any downloaded access-key CSV and clear the clipboard containing it.

If you already have an authorised setup-administrator CLI profile, the equivalent
commands are below. Replace the placeholders privately. Do not create root keys
or try these using `d618-owner` or `d618`:

```sh
aws iam delete-access-key --user-name d618-owner-login \
  --access-key-id YOUR_TONIGHT_KEY_ID --profile YOUR_SETUP_ADMIN_PROFILE
aws iam list-access-keys --user-name d618-owner-login \
  --profile YOUR_SETUP_ADMIN_PROFILE --query AccessKeyMetadata --output json
```

Require **`[]`** from the last command. Without that existing administrator
profile, use the console steps. Key deletion prevents future source-key use;
already-issued launcher sessions can remain valid until expiry.

## Stockholm availability and cost

Public sources checked on 10 November 2026 support tonight's **`eu-north-1`**
choice. They establish regional availability, not your account's quota or current
capacity; run part 8 and the quota/spend checks before launching.

| Template or setup dependency | Public evidence |
| --- | --- |
| Three `m7i.xlarge` instances | AWS's [regional instance list](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html) says “available in Europe (Stockholm)” and lists M7i; its [Stockholm price file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/eu-north-1/index.csv) has the Linux/shared `m7i.xlarge` row. |
| gp3 root disks, VPC, subnet, internet gateway, routes, firewall, public addresses | AWS's [EC2 endpoints](https://docs.aws.amazon.com/general/latest/gr/ec2-service.html) list “ec2.eu-north-1.amazonaws.com”; [EBS](https://docs.aws.amazon.com/general/latest/gr/ebs-service.html) and [VPC](https://docs.aws.amazon.com/general/latest/gr/vpc-service.html) resource actions use that API. The same Stockholm price file lists gp3. |
| Stack creation and deletion | AWS's [CloudFormation endpoints](https://docs.aws.amazon.com/general/latest/gr/cfn.html) list “cloudformation.eu-north-1.amazonaws.com”. |
| Independent deletion schedule | AWS's [Scheduler endpoints](https://docs.aws.amazon.com/general/latest/gr/eventbridgescheduler.html) list “scheduler.eu-north-1.amazonaws.com”. |
| IAM roles, user and role assumption | AWS lists Stockholm in its [IAM endpoints](https://docs.aws.amazon.com/general/latest/gr/iam-service.html) with “iam.amazonaws.com” and [STS endpoints](https://docs.aws.amazon.com/general/latest/gr/sts.html) with “sts.eu-north-1.amazonaws.com”. |
| USD 10 budget and spend read | AWS's [billing endpoints](https://docs.aws.amazon.com/general/latest/gr/billing.html) list the separate “budgets.amazonaws.com” and “ce.us-east-1.amazonaws.com” endpoints; these account-wide checks do not move the machines. |

The [90-minute estimate and late-deletion cost](superpowers/plans/2026-11-09-d618-bounded-amazon-run.md)
now use Stockholm prices: **USD 1.11 before tax / USD 1.35 with 21% VAT**, rounded
up, for three machines, their disks and addresses, plus one charged GB out.
Keep the USD 10 budget backstop and confirm deletion: neither the estimate nor the
budget stops an existing machine if teardown fails.

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
| Owner AssumeRole | The IAM user's one-run access key authenticates only the call to assume `d618-launcher` |
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
and [CLI access-key configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-authentication-user.html).
Live role assumption, CloudFormation tagging, rollback and independent deletion
remain checks for your practice-account run. If creation fails, keep the stack roles
until every stack resource has been deleted; inspect CloudFormation events as the
administrator rather than broadening the launcher permissions.
