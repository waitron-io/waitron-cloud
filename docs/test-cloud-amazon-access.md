# Give the test Cloud its own Amazon access

The one Spain machine is already authorised. These steps supply access that does
not exist yet; they create no production Cloud and do not reuse D618’s one-run role.
The watcher brings this to you before any console or provider change.

1. In Account → AWS Regions, check Europe (Spain), eu-south-2. If it is not
   enabled, [enable it](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-regions.html)
   and wait for its status to become Enabled. Then select an existing public subnet. The machine must have no NAT gateway, load balancer, managed database,
   extra disk or paid DNS zone. If there is no suitable subnet, K reports that
   missing input before creating anything outside the authorised machine.
2. In IAM, create a dedicated IAM user named waitron-test-cloud with no console
   access. Give it a custom policy for this test Cloud,
   not AdministratorAccess or the D618 policy. Use AWS’s EC2 tag-on-create policy
   examples to require cloud.campaign=TEST-CLOUD-AWS on created instances and
   their volumes, restrict launches to t3.medium in eu-south-2 and the chosen
   Debian image/subnet/security group, and allow management only for matching
   resources. Restrict the root disk to one encrypted 20 GiB gp3 disk. Limit public-address permissions to this workload’s tagged addresses, with no Route 53 or IAM administration permission.
   Discovery uses the read-only Describe calls needed to check these resources.
   Tag restrictions identify this workload; they do not cap the number of
   machines, disks or addresses. K checks for existing tagged resources and requests
   exactly one machine, one disk and one address. At launch K must explicitly select
   [standard CPU credits](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-how-to.html)
   (`--credit-specification CpuCredits=standard` with the CLI). Do not rely on
   the account default or the permission policy to prevent unlimited-credit charges.
3. In Billing, create a monthly USD50 cost budget with actual-cost alerts at 80%
   and 100%, addressed to your own mailbox. Confirm the verification email.
   A budget reports delayed costs; it is not a spending cap or an automatic stop.
4. Create a CLI access key for that user, then on the Mac run
   `aws configure --profile waitron-test-cloud`, selecting eu-south-2. Enter the
   key only in that private interactive prompt, never in chat or a command line. Keep the
   account and user details in your private AWS files, never in this repository
   or campaign notes. Tell the watcher the profile name when it is ready.
5. In EC2 → Key pairs → Import key pair, choose name waitron-test-cloud-k and
   import only ~/.config/waitron-cloud/test-cloud-aws/ssh/id_ed25519.pub. K created
   its new private key beside it, mode0600; it never leaves the Mac. In the
   machine’s security group, allow SSH only from the operator’s current address,
   and HTTPS on port 443. When K prepares public certificate issuance, also
   allow port 80 for Certbot’s standalone HTTP-01 listener and retain that ingress
   rule for every renewal. Certbot opens its listener only while issuing or
   renewing; the Cloud containers do not publish port 80. Remote-access ports remain closed until their service
   slice is qualified.

SES sending is still a later gate: grant only the test sender’s existing email
permissions once D102’s sender, region and feedback checks are settled. Do not
request production sending access, create feedback resources or add paid DNS
here. The owner’s real-email answer is not an approval of unreviewed supplier
or privacy work. Leave the machine running once its workflow deployment exists.

References: [EC2 scoped policies](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ExamplePolicies_EC2.html),
[budget timing](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html),
[budget email verification](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-budgets/).
Before attaching the policy, the watcher must check its exact actions and private
resource identifiers against these limits. This guide is not an executable IAM
policy or proof of access. K must still inspect the selected region, image, subnet,
security group and existing tagged resources before the one authorised launch.
Nothing here authorises using d570-staging or the temporary D618/D621 profile.
