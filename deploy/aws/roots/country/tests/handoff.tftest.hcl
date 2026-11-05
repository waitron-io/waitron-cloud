mock_provider "aws" {
  alias = "country"
  mock_resource "aws_cloudwatch_log_group" { defaults = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic" } }
  mock_resource "aws_sns_topic" { defaults = { arn = "arn:aws:sns:eu-south-2:333333333333:waitron-es-operator" } }
  mock_resource "aws_s3_bucket" { defaults = { id = "waitron-es-audit-333333333333-eu-south-2", arn = "arn:aws:s3:::waitron-es-audit-333333333333-eu-south-2" } }
  mock_resource "aws_budgets_budget" { defaults = { arn = "arn:aws:budgets::333333333333:budget/waitron-es-monthly" } }
  mock_resource "aws_cloudwatch_metric_alarm" { defaults = { arn = "arn:aws:cloudwatch:eu-south-2:333333333333:alarm:synthetic" } }
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZSPAIN", name_servers = ["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"] } }
  mock_resource "aws_eks_cluster" { defaults = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/SYNTHETIC" }] }] } }
  mock_resource "aws_security_group" { defaults = { id = "sg-00000000000000009" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::333333333333:role/synthetic" } }
  mock_resource "aws_launch_template" { defaults = { id = "lt-00000000000000001", latest_version = 1 } }
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}
mock_provider "aws" {
  alias = "country_backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
}
mock_provider "aws" {
  alias = "country_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}
mock_provider "aws" {
  alias = "country_backup_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
}
variables {
  budget_limit_usd  = 123.45
  dns               = { create_zone = false, existing_zone_id = "ZSPAIN" }
  database          = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 }
  recovery_role_arn = "arn:aws:iam::333333333333:role/waitron-es-recovery"
  compute           = { kubernetes_version = "1.34", operator_role_arns = ["arn:aws:iam::333333333333:role/operators/es-admin"] }
  deployment        = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } }
  bindings = {
    "country"             = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }
    "country_backup"      = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }
    "country_keys"        = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }
    "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }
  }
}
run "one_cell_complete_handoff" {
  command = plan
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.storage
    outputs = { storage = { stream_bucket = "waitron-es-stream-333333333333-eu-south-2", snapshot_bucket = "waitron-es-snapshot-333333333333-eu-south-2", backup_buckets = { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" }, kms_key_refs = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } } }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_es", admin_secret_ref = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { eus2-az1 = "subnet-00000000000000011", eus2-az2 = "subnet-00000000000000012", eus2-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { eus2-az1 = "subnet-00000000000000021", eus2-az2 = "subnet-00000000000000022", eus2-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { eus2-az1 = "rtb-00000000000000001", eus2-az2 = "rtb-00000000000000002", eus2-az3 = "rtb-00000000000000003" }
      cells = {
        "es-01" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" } }
        "es-02" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000004", eus2-az2 = "subnet-00000000000000005", eus2-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["es-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/es-01/1111111111111111", dns_name = "es-01.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  override_data {
    target = module.cell["es-01"].data.aws_caller_identity.current
    values = { account_id = "333333333333" }
  }
  override_data {
    target = module.cell["es-01"].data.aws_region.current
    values = { region = "eu-south-2" }
  }
  override_data {
    target = module.cell["es-01"].data.aws_availability_zones.current
    values = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["rds"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/rds/instance/waitron-es/postgresql" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["vpc"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/waitron/es/vpc-flow" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["eks/waitron-es-01"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/eks/waitron-es-01/cluster" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["metrics/waitron-es-01"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/containerinsights/waitron-es-01/performance" }
  }
  override_resource {
    target = module.cell["es-01"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/es-01" }] }] }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["api"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-api" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["portal"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-portal" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["registration-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-registration-worker" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["backup-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-worker" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["backup-verifier"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-verifier" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["remote-gateway"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-gateway" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["remote-reconciler"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-reconciler" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["monitor-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-monitor-worker" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb_target_group.service["https"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/es-01-https/1111111111111111" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb_target_group.service["wireguard"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/es-01-wireguard/1111111111111111" }
  }
}

run "two_cells_complete_handoff" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" }, "es-02" = { subnet_cidr = "10.20.32.0/20" } } } }
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.storage
    outputs = { storage = { stream_bucket = "waitron-es-stream-333333333333-eu-south-2", snapshot_bucket = "waitron-es-snapshot-333333333333-eu-south-2", backup_buckets = { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" }, kms_key_refs = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } } }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_es", admin_secret_ref = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { eus2-az1 = "subnet-00000000000000011", eus2-az2 = "subnet-00000000000000012", eus2-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { eus2-az1 = "subnet-00000000000000021", eus2-az2 = "subnet-00000000000000022", eus2-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { eus2-az1 = "rtb-00000000000000001", eus2-az2 = "rtb-00000000000000002", eus2-az3 = "rtb-00000000000000003" }
      cells = {
        "es-01" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" } }
        "es-02" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000004", eus2-az2 = "subnet-00000000000000005", eus2-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["es-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/es-01/1111111111111111", dns_name = "es-01.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  override_resource {
    target = module.cell["es-02"].aws_security_group.node
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = module.ingress["es-02"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/es-02/1111111111111111", dns_name = "es-02.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB2" }
  }
  override_data {
    target = module.cell["es-01"].data.aws_caller_identity.current
    values = { account_id = "333333333333" }
  }
  override_data {
    target = module.cell["es-01"].data.aws_region.current
    values = { region = "eu-south-2" }
  }
  override_data {
    target = module.cell["es-01"].data.aws_availability_zones.current
    values = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }
  }
  override_data {
    target = module.cell["es-02"].data.aws_caller_identity.current
    values = { account_id = "333333333333" }
  }
  override_data {
    target = module.cell["es-02"].data.aws_region.current
    values = { region = "eu-south-2" }
  }
  override_data {
    target = module.cell["es-02"].data.aws_availability_zones.current
    values = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["rds"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/rds/instance/waitron-es/postgresql" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["vpc"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/waitron/es/vpc-flow" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["eks/waitron-es-01"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/eks/waitron-es-01/cluster" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["metrics/waitron-es-01"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/containerinsights/waitron-es-01/performance" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["eks/waitron-es-02"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/eks/waitron-es-02/cluster" }
  }
  override_resource {
    target = module.observability.aws_cloudwatch_log_group.operational["metrics/waitron-es-02"]
    values = { arn = "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/containerinsights/waitron-es-02/performance" }
  }
  override_resource {
    target = module.cell["es-01"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/es-01" }] }] }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["api"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-api" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["portal"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-portal" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["registration-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-registration-worker" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["backup-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-worker" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["backup-verifier"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-verifier" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["remote-gateway"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-gateway" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["remote-reconciler"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-reconciler" }
  }
  override_resource {
    target = module.workload_permissions["es-01"].aws_iam_role.workload["monitor-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-01-monitor-worker" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb_target_group.service["https"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/es-01-https/1111111111111111" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb_target_group.service["wireguard"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/es-01-wireguard/1111111111111111" }
  }
  override_resource {
    target = module.cell["es-02"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/es-02" }] }] }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["api"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-api" }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["portal"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-portal" }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["registration-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-registration-worker" }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["backup-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-backup-worker" }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["backup-verifier"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-backup-verifier" }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["remote-gateway"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-remote-gateway" }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["remote-reconciler"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-remote-reconciler" }
  }
  override_resource {
    target = module.workload_permissions["es-02"].aws_iam_role.workload["monitor-worker"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-es-02-monitor-worker" }
  }
  override_resource {
    target = module.ingress["es-02"].aws_lb_target_group.service["https"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/es-02-https/1111111111111111" }
  }
  override_resource {
    target = module.ingress["es-02"].aws_lb_target_group.service["wireguard"]
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/es-02-wireguard/1111111111111111" }
  }
}
