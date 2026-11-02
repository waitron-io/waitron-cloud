mock_provider "aws" {
  alias = "global"
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
run "distinct_global_country_and_backup_bindings" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  assert {
    condition     = output.deployment_admission.version == 1 && output.deployment_admission.scope == "global" && output.deployment_admission.country == null
    error_message = "DISTINCT_SCOPE_BINDINGS: this independent root must admit only its own versioned deployment"
  }
  assert {
    condition     = output.deployment_admission.regions == { primary = "eu-central-1", backup = "eu-west-1" }
    error_message = "DISTINCT_REGIONAL_BINDINGS: the handoff must come from the actual independently bound providers"
  }
}
run "rejects_unknown_version" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { deployment = { version = 2, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_scope" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { deployment = { version = 1, scope = "country", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_country" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { deployment = { version = 1, scope = "global", country = "es", primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_regions" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-central-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_cell_scope" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "es-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_missing_global" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_global_backup" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_global_keys" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_global_backup_keys" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_extra_scope_binding" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "organization" = { expected_identity = "111111111111", role_arn = "arn:aws:iam::111111111111:role/admin" } } }
  expect_failures = [var.bindings]
}
run "rejects_malformed_identity" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_crossed_role" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::999999999999:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_wildcard_role" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/*" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_deployment_as_key_admin" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_different_backup_account" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "999999999999", role_arn = "arn:aws:iam::999999999999:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_actual_global_account" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_caller_identity.global
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_region" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_region.global
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_account" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_caller_identity.global_backup
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_region" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_region.global_backup
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_keys_account" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_caller_identity.global_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_keys_region" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_region.global_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_keys_account" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_caller_identity.global_backup_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_keys_region" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  override_data {
    target = data.aws_region.global_backup_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_all_malformed_identities" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { bindings = { "global" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_primary_region" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-north-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_malformed_cell" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-any" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}

run "primary_cells_use_their_exact_network_entries" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" }, "global-02" = { subnet_cidr = "10.10.32.0/20" } } } }
  assert {
    condition     = toset(keys(output.primary_topology.cells)) == toset(["global-01", "global-02"]) && output.primary_topology.cells["global-01"].cluster_name == "waitron-global-01" && output.primary_topology.cells["global-02"].cluster_name == "waitron-global-02" && output.primary_topology.cells["global-01"].private_subnet_ids == tomap({ euc1-az1 = "subnet-00000000000000001", euc1-az2 = "subnet-00000000000000002", euc1-az3 = "subnet-00000000000000003" }) && output.primary_topology.cells["global-02"].private_subnet_ids == tomap({ euc1-az1 = "subnet-00000000000000004", euc1-az2 = "subnet-00000000000000005", euc1-az3 = "subnet-00000000000000006" })
    error_message = "EXACT_CELL_NETWORK: each real cluster must consume its own three subnets"
  }
}

run "rejects_foreign_operator_account_before_cell_reads" {
  command = plan
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = {}, backup_secret_refs = {} }
  }
  override_module {
    target  = module.database
    outputs = { database = null }
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
  override_module {
    target  = module.cell
    outputs = { cell = null }
  }
  variables { compute = { kubernetes_version = "1.34", operator_role_arns = ["arn:aws:iam::999999999999:role/operators/admin"] } }
  expect_failures = [var.compute]
}
