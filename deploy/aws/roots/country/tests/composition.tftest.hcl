mock_provider "aws" {
  alias = "country"
  mock_resource "aws_lb" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/synthetic/1111111111111111" } }
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZSPAIN", name_servers = ["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"] } }
  mock_resource "aws_db_instance" { defaults = {
    arn                = "arn:aws:rds:eu-south-2:333333333333:db:waitron-es"
    address            = "waitron-es.synthetic.invalid"
    master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_id = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", secret_status = "active" }]
  } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/synthetic-ABCDEF" } }
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
  mock_resource "aws_db_instance_automated_backups_replication" { defaults = { id = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
}
mock_provider "aws" {
  alias = "country_keys"
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}
mock_provider "aws" {
  alias = "country_backup_keys"
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" } }
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
run "data_topology_binds_database_and_cold_keys" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = {}, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_resource {
    target = module.custody.aws_iam_role.replication["storage"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }
  }
  assert {
    condition = output.data_topology.database == {
      endpoint         = "waitron-es.synthetic.invalid", port = 5432, name = "cloud_es"
      admin_secret_ref = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF"
      kms_key_ref      = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic"
    } && output.data_topology.keys.database == "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" && output.data_topology.backup_keys.database == "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222"
    error_message = "COMPOSED_DATABASE_KEYS: the real management database and cold copy must consume their distinct regional database keys"
  }
}

run "data_topology_retains_every_secret_copy" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = {}, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_resource {
    target = module.custody.aws_iam_role.replication["storage"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }
  }
  assert {
    condition     = toset(keys(output.data_topology.secret_refs)) == toset(["backup-master-key", "email-key-ring", "gateway-signing", "wireguard", "installation-signing"]) && toset(keys(output.data_topology.backup_secret_refs)) == toset(keys(output.data_topology.secret_refs)) && alltrue([for purpose, ref in output.data_topology.secret_refs : startswith(ref, "arn:aws:secretsmanager:eu-south-2:333333333333:") && output.data_topology.backup_secret_refs[purpose] == replace(ref, ":eu-south-2:", ":eu-west-3:")])
    error_message = "COMPOSED_RETAINED_SECRETS: every scope secret shell must retain a reference in its own cold region"
  }
}

run "storage_and_scope_permissions_bind_cold_copies" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = {}, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_resource {
    target = module.custody.aws_iam_role.replication["storage"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }
  }
  override_resource {
    target = module.cell["es-01"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/CELL01" }] }] }
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
  assert {
    condition     = output.storage_topology.admitted && (try(output.storage_topology.storage.stream_bucket == "waitron-es-stream-333333333333-eu-south-2" && output.storage_topology.storage.snapshot_bucket == "waitron-es-snapshot-333333333333-eu-south-2" && output.storage_topology.storage.backup_buckets == { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" } && output.storage_topology.storage.kms_key_refs == { primary = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", backup = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" }, false) && toset(keys(output.storage_topology.attachments)) == toset(["recovery", "replication-storage"]))
    error_message = "COMPOSED_SCOPE_STORAGE: actual stores and shared policy ownership must stay bound to the same scope regardless of cell count"
  }
  assert {
    condition     = { for cell, value in output.workload_topology : cell => value.workload_roles } == { "es-01" = { "api" = "arn:aws:iam::333333333333:role/waitron-es-es-01-api", "portal" = "arn:aws:iam::333333333333:role/waitron-es-es-01-portal", "registration-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-01-registration-worker", "backup-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-worker", "backup-verifier" = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-verifier", "remote-gateway" = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-gateway", "remote-reconciler" = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-reconciler", "monitor-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-01-monitor-worker" } } && alltrue([for value in values(output.workload_topology) : toset(keys(value.attachments)) == toset(["api", "registration-worker", "backup-worker", "backup-verifier", "remote-gateway", "remote-reconciler", "monitor-worker"])])
    error_message = "COMPOSED_CELL_WORKLOADS: every selected cell needs its own complete role set and only its runtime policy attachments"
  }

}

run "two_cells_share_scope_permissions" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = {}, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_resource {
    target = module.custody.aws_iam_role.replication["storage"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  variables {
    deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" }, "es-02" = { subnet_cidr = "10.20.32.0/20" } } }
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }
  }
  assert {
    condition     = output.storage_topology.admitted && (try(output.storage_topology.storage.stream_bucket == "waitron-es-stream-333333333333-eu-south-2" && output.storage_topology.storage.snapshot_bucket == "waitron-es-snapshot-333333333333-eu-south-2" && output.storage_topology.storage.backup_buckets == { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" } && output.storage_topology.storage.kms_key_refs == { primary = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", backup = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" }, false) && toset(keys(output.storage_topology.attachments)) == toset(["recovery", "replication-storage"]))
    error_message = "COMPOSED_SCOPE_STORAGE: actual stores and shared policy ownership must stay bound to the same scope regardless of cell count"
  }
}

run "rejects_store_references_that_differ_from_permission_targets" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = {}, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_resource {
    target = module.custody.aws_iam_role.replication["storage"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }
  }
  override_module {
    target = module.storage
    outputs = { storage = {
      stream_bucket   = "waitron-es-unbound-stream-333333333333-eu-south-2"
      snapshot_bucket = "waitron-es-snapshot-333333333333-eu-south-2"
      backup_buckets  = { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" }
      kms_key_refs = {
        primary = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444"
        backup  = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555"
      }
    } }
  }
  expect_failures = [output.storage_topology]
}


run "two_cells_keep_distinct_workload_roles" {
  command = plan
  override_module {
    target  = module.observability
    outputs = { observability = { logs = {}, signals = {}, budget_ref = "synthetic-budget" } }
  }
  override_resource {
    target = module.custody.aws_iam_role.replication["storage"]
    values = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }
  }
  variables {
    deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" }, "es-02" = { subnet_cidr = "10.20.32.0/20" } } }
  }
  override_resource {
    target = module.cell["es-01"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/CELL01" }] }] }
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
    target = module.cell["es-02"].aws_eks_cluster.cell
    values = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/CELL02" }] }] }
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
  assert {
    condition     = { for cell, value in output.workload_topology : cell => value.workload_roles } == { "es-01" = { "api" = "arn:aws:iam::333333333333:role/waitron-es-es-01-api", "portal" = "arn:aws:iam::333333333333:role/waitron-es-es-01-portal", "registration-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-01-registration-worker", "backup-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-worker", "backup-verifier" = "arn:aws:iam::333333333333:role/waitron-es-es-01-backup-verifier", "remote-gateway" = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-gateway", "remote-reconciler" = "arn:aws:iam::333333333333:role/waitron-es-es-01-remote-reconciler", "monitor-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-01-monitor-worker" }, "es-02" = { "api" = "arn:aws:iam::333333333333:role/waitron-es-es-02-api", "portal" = "arn:aws:iam::333333333333:role/waitron-es-es-02-portal", "registration-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-02-registration-worker", "backup-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-02-backup-worker", "backup-verifier" = "arn:aws:iam::333333333333:role/waitron-es-es-02-backup-verifier", "remote-gateway" = "arn:aws:iam::333333333333:role/waitron-es-es-02-remote-gateway", "remote-reconciler" = "arn:aws:iam::333333333333:role/waitron-es-es-02-remote-reconciler", "monitor-worker" = "arn:aws:iam::333333333333:role/waitron-es-es-02-monitor-worker" } } && alltrue([for value in values(output.workload_topology) : toset(keys(value.attachments)) == toset(["api", "registration-worker", "backup-worker", "backup-verifier", "remote-gateway", "remote-reconciler", "monitor-worker"])])
    error_message = "COMPOSED_CELL_WORKLOADS: every selected cell needs its own complete role set and only its runtime policy attachments"
  }
}
