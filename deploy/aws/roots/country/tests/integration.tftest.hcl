mock_provider "aws" {
  alias = "country"
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
  deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } }
  bindings = {
    "country"             = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }
    "country_backup"      = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }
    "country_keys"        = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }
    "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }
  }
}
run "distinct_global_country_and_backup_bindings" {
  command = plan
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
  variables { deployment = { version = 2, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_scope" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_country" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = null, primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_regions" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-south-2", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_unknown_cell_scope" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "global-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_missing_country" {
  command = plan
  variables { bindings = { "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_country_backup" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_country_keys" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_missing_country_backup_keys" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_extra_scope_binding" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "organization" = { expected_identity = "111111111111", role_arn = "arn:aws:iam::111111111111:role/admin" } } }
  expect_failures = [var.bindings]
}
run "rejects_malformed_identity" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_crossed_role" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::999999999999:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_wildcard_role" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/*" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_deployment_as_key_admin" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_different_backup_account" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "999999999999", role_arn = "arn:aws:iam::999999999999:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_actual_country_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.country
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_region" {
  command = plan
  override_data {
    target = data.aws_region.country
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.country_backup
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_region" {
  command = plan
  override_data {
    target = data.aws_region.country_backup
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_keys_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.country_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_keys_region" {
  command = plan
  override_data {
    target = data.aws_region.country_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_keys_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.country_backup_keys
    values = { account_id = "999999999999" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_actual_country_backup_keys_region" {
  command = plan
  override_data {
    target = data.aws_region.country_backup_keys
    values = { region = "eu-north-1" }
  }
  expect_failures = [output.deployment_admission]
}
run "rejects_all_malformed_identities" {
  command = plan
  variables { bindings = { "country" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-deployment" }, "country_backup" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-deployment" }, "country_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-key-administration" }, "country_backup_keys" = { expected_identity = "not-an-account", role_arn = "arn:aws:iam::not-an-account:role/waitron-es-key-administration" }, } }
  expect_failures = [var.bindings]
}
run "rejects_primary_region" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-north-1", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
run "rejects_malformed_cell" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-any" = { subnet_cidr = "10.20.16.0/20" } } } }
  expect_failures = [var.deployment]
}
