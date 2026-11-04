mock_provider "aws" {
  alias = "global"
  mock_resource "aws_cloudwatch_log_group" { defaults = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:synthetic" } }
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:eu-central-1:222222222222:waitron-global-operator" } }
  mock_resource "aws_s3_bucket" { defaults = { id = "waitron-global-audit-222222222222-eu-central-1", arn = "arn:aws:s3:::waitron-global-audit-222222222222-eu-central-1" } }
  mock_resource "aws_budgets_budget" { defaults = { arn = "arn:aws:budgets::222222222222:budget/waitron-global-monthly" } }
  mock_resource "aws_cloudwatch_metric_alarm" { defaults = { arn = "arn:aws:cloudwatch:eu-central-1:222222222222:alarm:synthetic" } }
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/synthetic/1111111111111111" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZGLOBAL", name_servers = ["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"] } }
  mock_resource "aws_eks_cluster" { defaults = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-central-1.amazonaws.com/id/SYNTHETIC" }] }] } }
  mock_resource "aws_security_group" { defaults = { id = "sg-00000000000000009" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::222222222222:role/synthetic" } }
  mock_resource "aws_launch_template" { defaults = { id = "lt-00000000000000001", latest_version = 1 } }
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
}
mock_provider "aws" {
  alias = "global_backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-west-1" } }
}
mock_provider "aws" {
  alias = "global_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
}
mock_provider "aws" {
  alias = "global_backup_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-west-1" } }
}
variables {
  budget_limit_usd  = 123.45
  dns               = { create_zone = false, existing_zone_id = "ZGLOBAL" }
  database          = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 }
  recovery_role_arn = "arn:aws:iam::222222222222:role/waitron-global-recovery"
  compute           = { kubernetes_version = "1.34", operator_role_arns = ["arn:aws:iam::222222222222:role/operators/global-admin"] }
  deployment        = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } }
  bindings = {
    "global"             = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }
    "global_backup"      = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }
    "global_keys"        = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }
    "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }
  }
}
run "one_cell_complete_handoff" {
  command = plan
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = null }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = { "email-key-ring" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, backup_secret_refs = { "email-key-ring" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, replication_role_arn = null }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_global", admin_secret_ref = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-1:222222222222:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { euc1-az1 = "subnet-00000000000000011", euc1-az2 = "subnet-00000000000000012", euc1-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { euc1-az1 = "subnet-00000000000000021", euc1-az2 = "subnet-00000000000000022", euc1-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { euc1-az1 = "rtb-00000000000000001", euc1-az2 = "rtb-00000000000000002", euc1-az3 = "rtb-00000000000000003" }
      cells = {
        "global-01" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000001", euc1-az2 = "subnet-00000000000000002", euc1-az3 = "subnet-00000000000000003" } }
        "global-02" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000004", euc1-az2 = "subnet-00000000000000005", euc1-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["global-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["global-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:loadbalancer/net/global-01/1111111111111111", dns_name = "global-01.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  override_data {
    target = module.cell["global-01"].data.aws_caller_identity.current
    values = { account_id = "222222222222" }
  }
  override_data {
    target = module.cell["global-01"].data.aws_region.current
    values = { region = "eu-central-1" }
  }
  override_data {
    target = module.cell["global-01"].data.aws_availability_zones.current
    values = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["rds"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/rds/instance/waitron-global/postgresql" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["vpc"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/waitron/global/vpc-flow" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["eks/waitron-global-01"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/eks/waitron-global-01/cluster" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["metrics/waitron-global-01"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/containerinsights/waitron-global-01/performance" }
  }
  override_resource {
    target = module.cell["global-01"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-central-1.amazonaws.com/id/global-01" }] }] }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["api"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-api" }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["portal"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-portal" }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["registration-worker"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-registration-worker" }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["monitor-worker"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-monitor-worker" }
  }
  override_resource {
    target = module.ingress["global-01"].aws_lb_target_group.service["https"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/global-01-https/1111111111111111" }
  }
}

run "two_cells_complete_handoff" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" }, "global-02" = { subnet_cidr = "10.10.32.0/20" } } } }
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = null }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = { "email-key-ring" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, backup_secret_refs = { "email-key-ring" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, replication_role_arn = null }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_global", admin_secret_ref = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-1:222222222222:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { euc1-az1 = "subnet-00000000000000011", euc1-az2 = "subnet-00000000000000012", euc1-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { euc1-az1 = "subnet-00000000000000021", euc1-az2 = "subnet-00000000000000022", euc1-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { euc1-az1 = "rtb-00000000000000001", euc1-az2 = "rtb-00000000000000002", euc1-az3 = "rtb-00000000000000003" }
      cells = {
        "global-01" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000001", euc1-az2 = "subnet-00000000000000002", euc1-az3 = "subnet-00000000000000003" } }
        "global-02" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000004", euc1-az2 = "subnet-00000000000000005", euc1-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["global-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["global-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:loadbalancer/net/global-01/1111111111111111", dns_name = "global-01.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  override_resource {
    target = module.cell["global-02"].aws_security_group.node
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = module.ingress["global-02"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:loadbalancer/net/global-02/1111111111111111", dns_name = "global-02.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB2" }
  }
  override_data {
    target = module.cell["global-01"].data.aws_caller_identity.current
    values = { account_id = "222222222222" }
  }
  override_data {
    target = module.cell["global-01"].data.aws_region.current
    values = { region = "eu-central-1" }
  }
  override_data {
    target = module.cell["global-01"].data.aws_availability_zones.current
    values = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }
  }
  override_data {
    target = module.cell["global-02"].data.aws_caller_identity.current
    values = { account_id = "222222222222" }
  }
  override_data {
    target = module.cell["global-02"].data.aws_region.current
    values = { region = "eu-central-1" }
  }
  override_data {
    target = module.cell["global-02"].data.aws_availability_zones.current
    values = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["rds"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/rds/instance/waitron-global/postgresql" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["vpc"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/waitron/global/vpc-flow" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["eks/waitron-global-01"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/eks/waitron-global-01/cluster" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["metrics/waitron-global-01"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/containerinsights/waitron-global-01/performance" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["eks/waitron-global-02"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/eks/waitron-global-02/cluster" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["metrics/waitron-global-02"]
    values = { arn = "arn:aws:logs:eu-central-1:222222222222:log-group:/aws/containerinsights/waitron-global-02/performance" }
  }
  override_resource {
    target = module.cell["global-01"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-central-1.amazonaws.com/id/global-01" }] }] }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["api"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-api" }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["portal"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-portal" }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["registration-worker"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-registration-worker" }
  }
  override_resource {
    target = module.workload_permissions["global-01"].aws_iam_role.workload["monitor-worker"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-01-monitor-worker" }
  }
  override_resource {
    target = module.ingress["global-01"].aws_lb_target_group.service["https"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/global-01-https/1111111111111111" }
  }
  override_resource {
    target = module.cell["global-02"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-central-1.amazonaws.com/id/global-02" }] }] }
  }
  override_resource {
    target = module.workload_permissions["global-02"].aws_iam_role.workload["api"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-02-api" }
  }
  override_resource {
    target = module.workload_permissions["global-02"].aws_iam_role.workload["portal"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-02-portal" }
  }
  override_resource {
    target = module.workload_permissions["global-02"].aws_iam_role.workload["registration-worker"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-02-registration-worker" }
  }
  override_resource {
    target = module.workload_permissions["global-02"].aws_iam_role.workload["monitor-worker"]
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-global-02-monitor-worker" }
  }
  override_resource {
    target = module.ingress["global-02"].aws_lb_target_group.service["https"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/global-02-https/1111111111111111" }
  }
}
