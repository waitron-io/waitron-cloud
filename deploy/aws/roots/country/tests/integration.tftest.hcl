mock_provider "aws" {
  alias = "country"
  mock_resource "aws_lb" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/synthetic/1111111111111111" } }
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
run "distinct_global_country_and_backup_bindings" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  assert {
    condition     = output.deployment_admission.version == 1 && output.deployment_admission.scope == "country" && output.deployment_admission.country == "es"
    error_message = "DISTINCT_SCOPE_BINDINGS: this independent root must admit only its own versioned deployment"
  }
  assert {
    condition     = output.deployment_admission.regions == { primary = "eu-south-2", backup = "eu-west-3" }
    error_message = "DISTINCT_REGIONAL_BINDINGS: the handoff must come from the actual independently bound providers"
  }
}
run "rejects_unknown_version" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { deployment = { version = 2, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_scope" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { deployment = { version = 1, scope = "global", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_country" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { deployment = { version = 1, scope = "country", country = null, primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_regions" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-south-2", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_cell_scope" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "global-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_missing_country" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_country_backup" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_country_keys" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_country_backup_keys" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_extra_scope_binding" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "organization" = { expected_identity = "111111111111", role_arn = "arn:aws:iam::111111111111:role/admin" } } }
  expect_failures = [var.bindings]
}
run "rejects_malformed_identity" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_crossed_role" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::999999999999:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_wildcard_role" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/*" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_deployment_as_key_admin" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_different_backup_account" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "999999999999", role_arn = "arn:aws:iam::999999999999:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_actual_country_account" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  # Match downstream stores to the reported account so only root admission refuses.
  override_module {
    target  = module.storage
    outputs = { storage = { stream_bucket = "waitron-es-stream-999999999999-eu-south-2", snapshot_bucket = "waitron-es-snapshot-999999999999-eu-south-2", backup_buckets = { stream = "waitron-es-stream-999999999999-eu-west-3", snapshot = "waitron-es-snapshot-999999999999-eu-west-3" }, kms_key_refs = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } } }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_caller_identity.country
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_region" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_region.country
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_account" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_caller_identity.country_backup
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_region" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_region.country_backup
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_keys_account" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_caller_identity.country_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_keys_region" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_region.country_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_keys_account" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_caller_identity.country_backup_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_keys_region" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  override_data {
    target = data.aws_region.country_backup_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_all_malformed_identities" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { bindings = { "country" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_primary_region" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-north-1", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_malformed_cell" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-any" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}

run "primary_cells_use_their_exact_network_entries" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" }, "es-02" = { subnet_cidr = "10.20.32.0/20" } } } }
  assert {
    condition     = toset(keys(output.primary_topology.cells)) == toset(["es-01", "es-02"]) && output.primary_topology.cells["es-01"].cluster_name == "waitron-es-01" && output.primary_topology.cells["es-02"].cluster_name == "waitron-es-02" && output.primary_topology.cells["es-01"].private_subnet_ids == tomap({ eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }) && output.primary_topology.cells["es-02"].private_subnet_ids == tomap({ eus2-az1 = "subnet-00000000000000004", eus2-az2 = "subnet-00000000000000005", eus2-az3 = "subnet-00000000000000006" })
    error_message = "EXACT_CELL_NETWORK: each real cluster must consume its own three subnets"
  }
}

run "rejects_foreign_operator_account_before_cell_reads" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = { "rds" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-rds", "vpc" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-vpc", "eks/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-01", "metrics/waitron-es-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-01", "eks/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-02", "metrics/waitron-es-02" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-02", "eks/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-es-any", "metrics/waitron-es-any" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-es-any", "eks/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-eks-global-01", "metrics/waitron-global-01" = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic-metrics-global-01" }, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_module {
    target  = module.ingress
    outputs = { ingress = { dns_name = "synthetic.invalid", zone_id = "ZFIXTURE", tcp_ports = [443], udp_ports = [51820], target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } }
  }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
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
  override_module {
    target  = module.cell
    outputs = { cell = { cluster_name = "waitron-es-fixture", region = "eu-south-2", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"], private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, node_security_group_id = "sg-00000000000000009", oidc_issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/ADMISSION" } }
  }
  variables { compute = { kubernetes_version = "1.34", operator_role_arns = ["arn:aws:iam::999999999999:role/operators/admin"] } }
  expect_failures = [var.compute]
}
