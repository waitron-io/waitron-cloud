mock_provider "aws" {
  alias = "global"
  mock_resource "aws_db_instance" { defaults = {
    arn                = "arn:aws:rds:eu-central-1:222222222222:db:waitron-global"
    address            = "waitron-global.synthetic.invalid"
    master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:admin-ABCDEF", kms_key_id = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", secret_status = "active" }]
  } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/synthetic-ABCDEF" } }
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
  mock_resource "aws_db_instance_automated_backups_replication" { defaults = { id = "arn:aws:rds:eu-west-1:222222222222:auto-backup:synthetic" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-west-1" } }
}
mock_provider "aws" {
  alias = "global_keys"
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-central-1:222222222222:key/44444444-4444-4444-4444-444444444444" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
}
mock_provider "aws" {
  alias = "global_backup_keys"
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-west-1:222222222222:key/55555555-5555-5555-5555-555555555555" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-west-1" } }
}
variables {
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
run "data_topology_binds_database_and_cold_keys" {
  command = plan
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }
  }
  assert {
    condition = output.data_topology.database == {
      endpoint         = "waitron-global.synthetic.invalid", port = 5432, name = "cloud_global"
      admin_secret_ref = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:admin-ABCDEF"
      kms_key_ref      = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-1:222222222222:auto-backup:synthetic"
    } && output.data_topology.keys.database == "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" && output.data_topology.backup_keys.database == "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222"
    error_message = "COMPOSED_DATABASE_KEYS: the real management database and cold copy must consume their distinct regional database keys"
  }
}

run "data_topology_retains_every_secret_copy" {
  command = plan
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }
  }
  assert {
    condition     = toset(keys(output.data_topology.secret_refs)) == toset(["email-key-ring", "sign-in-signing"]) && toset(keys(output.data_topology.backup_secret_refs)) == toset(keys(output.data_topology.secret_refs)) && alltrue([for purpose, ref in output.data_topology.secret_refs : startswith(ref, "arn:aws:secretsmanager:eu-central-1:222222222222:") && output.data_topology.backup_secret_refs[purpose] == replace(ref, ":eu-central-1:", ":eu-west-1:")])
    error_message = "COMPOSED_RETAINED_SECRETS: every scope secret shell must retain a reference in its own cold region"
  }
}

run "storage_and_scope_permissions_bind_cold_copies" {
  command = plan
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }
  }
  assert {
    condition     = output.storage_topology.admitted && (output.storage_topology.storage == null && toset(keys(output.storage_topology.attachments)) == toset(["recovery"]))
    error_message = "COMPOSED_SCOPE_STORAGE: actual stores and shared policy ownership must stay bound to the same scope regardless of cell count"
  }
}

run "two_cells_share_scope_permissions" {
  command = plan
  variables {
    deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" }, "global-02" = { subnet_cidr = "10.10.32.0/20" } } }
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
    target = module.custody.aws_kms_key.primary["database"]
    values = { arn = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }
  }
  override_resource {
    target = module.custody.aws_kms_key.backup["database"]
    values = { arn = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }
  }
  assert {
    condition     = output.storage_topology.admitted && (output.storage_topology.storage == null && toset(keys(output.storage_topology.attachments)) == toset(["recovery"]))
    error_message = "COMPOSED_SCOPE_STORAGE: actual stores and shared policy ownership must stay bound to the same scope regardless of cell count"
  }
}
