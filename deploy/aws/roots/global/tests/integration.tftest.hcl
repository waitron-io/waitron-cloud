mock_provider "aws" {
  alias = "global"
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
  deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } }
  bindings = {
    "global"             = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }
    "global_backup"      = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }
    "global_keys"        = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }
    "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }
  }
}
run "distinct_global_country_and_backup_bindings" {
  command = plan
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
  variables { deployment = { version = 2, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_scope" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_country" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = "es", primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_regions" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-central-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_cell_scope" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "es-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_missing_global" {
  command = plan
  variables { bindings = { "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_global_backup" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_global_keys" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_global_backup_keys" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_extra_scope_binding" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "organization" = { expected_identity = "111111111111", role_arn = "arn:aws:iam::111111111111:role/admin" } } }
  expect_failures = [var.bindings]
}
run "rejects_malformed_identity" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_crossed_role" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::999999999999:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_wildcard_role" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/*" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_deployment_as_key_admin" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_different_backup_account" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "999999999999", role_arn = "arn:aws:iam::999999999999:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_actual_global_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.global
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_region" {
  command = plan
  override_data {
    target = data.aws_region.global
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.global_backup
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_region" {
  command = plan
  override_data {
    target = data.aws_region.global_backup
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_keys_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.global_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_keys_region" {
  command = plan
  override_data {
    target = data.aws_region.global_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_keys_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.global_backup_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_global_backup_keys_region" {
  command = plan
  override_data {
    target = data.aws_region.global_backup_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_all_malformed_identities" {
  command = plan
  variables { bindings = { "global" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-deployment" }, "global_backup" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-deployment" }, "global_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-key-administration" }, "global_backup_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-global-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_primary_region" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-north-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_malformed_cell" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-any" = { subnet_cidr = "10.10.16.0/20" } } } }
  expect_failures = [var.deployment]
}
