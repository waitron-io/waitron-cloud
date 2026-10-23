mock_provider "aws" {
  alias = "wrong_primary"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
}
mock_provider "aws" {
  alias = "wrong_backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
}
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
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" } }
  mock_resource "aws_db_instance" { defaults = { arn = "arn:aws:rds:eu-south-2:333333333333:db:waitron-es", address = "waitron-es.synthetic.invalid", master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_id = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", secret_status = "active" }] } }
}
mock_provider "aws" {
  alias = "backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" } }
}
variables {
  scope       = "es"
  region_pair = { primary = "eu-south-2", backup = "eu-west-3" }
  authorities = { deployment = "arn:aws:iam::333333333333:role/waitron-es-deployment", key_administration = "arn:aws:iam::333333333333:role/waitron-es-key-administration", recovery = "arn:aws:iam::333333333333:role/waitron-es-recovery" }
}
run "separate_regional_rotating_keys" {
  command = plan
  assert {
    condition     = alltrue([for key in concat(values(aws_kms_key.primary), values(aws_kms_key.backup)) : key.enable_key_rotation && key.deletion_window_in_days == 30 && key.key_usage == "ENCRYPT_DECRYPT" && key.customer_master_key_spec == "SYMMETRIC_DEFAULT" && key.multi_region != true])
    error_message = "KEY_RETENTION: separate symmetric regional keys must rotate and keep a 30-day recovery window"
  }
}
run "retained_keys_have_recovery_copy" {
  command = plan
  assert {
    condition     = length(output.secrets) == 5 && toset(keys(output.backup_secret_refs)) == toset(["backup-master-key", "email-key-ring", "gateway-signing", "wireguard", "installation-signing"]) && alltrue([for purpose, arn in output.secrets : output.backup_secret_refs[purpose] == replace(arn, ":eu-south-2:", ":eu-west-3:")])
    error_message = "RETAINED_KEY_COPIES: all five country secret shells need corresponding Paris references"
  }
}
run "replication_service_trust" {
  command = plan
  assert {
    condition     = try(jsondecode(aws_iam_role.replication["storage"].assume_role_policy).Statement == [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "s3.amazonaws.com" }, Condition = { StringEquals = { "aws:SourceAccount" = "333333333333" }, ArnEquals = { "aws:SourceArn" = ["arn:aws:s3:::waitron-es-stream-333333333333-eu-south-2", "arn:aws:s3:::waitron-es-snapshot-333333333333-eu-south-2"] } } }], false)
    error_message = "REPLICATION_TRUST: only S3 from these exact source buckets/account may assume the shell"
  }
}
run "country_cannot_read_global" {
  command = plan
  assert {
    condition     = try(alltrue([for key in concat(values(aws_kms_key.primary), values(aws_kms_key.backup)) : jsondecode(key.policy).Statement[0].Principal.AWS == var.authorities.key_administration && jsondecode(key.policy).Statement[1].Principal.AWS == "arn:aws:iam::333333333333:root" && !strcontains(key.policy, "kms:*") && !strcontains(key.policy, ":222222222222:")]), false)
    error_message = "KEY_AUTHORITY: key management and same-account use must be separate and explicit"
  }
}
run "rejects_unknown_scope" {
  command = plan
  variables {
    scope = "fr"
  }
  expect_failures = [var.scope]
}
run "rejects_wrong_regions" {
  command = plan
  variables {
    region_pair = { primary = "eu-south-2", backup = "eu-west-1" }
  }
  expect_failures = [var.region_pair]
}
run "rejects_wildcard_authority" {
  command = plan
  variables {
    authorities = { deployment = "arn:aws:iam::333333333333:role/waitron-es-deployment", key_administration = "*", recovery = "arn:aws:iam::333333333333:role/waitron-es-recovery" }
  }
  expect_failures = [var.authorities]
}
run "rejects_shared_authority" {
  command = plan
  variables {
    authorities = { deployment = "arn:aws:iam::333333333333:role/waitron-es-recovery", key_administration = "arn:aws:iam::333333333333:role/waitron-es-key-administration", recovery = "arn:aws:iam::333333333333:role/waitron-es-recovery" }
  }
  expect_failures = [var.authorities]
}
run "rejects_foreign_authority" {
  command = plan
  variables {
    authorities = { deployment = "arn:aws:iam::222222222222:role/waitron-es-deployment", key_administration = "arn:aws:iam::333333333333:role/waitron-es-key-administration", recovery = "arn:aws:iam::333333333333:role/waitron-es-recovery" }
  }
  expect_failures = [output.kms]
}
run "independent_global_custody" {
  command   = plan
  providers = { aws = aws.global, aws.backup = aws.global_backup }
  variables {
    scope       = "global"
    region_pair = { primary = "eu-central-1", backup = "eu-west-1" }
    authorities = { deployment = "arn:aws:iam::222222222222:role/waitron-global-deployment", key_administration = "arn:aws:iam::222222222222:role/waitron-global-key-administration", recovery = "arn:aws:iam::222222222222:role/waitron-global-recovery" }
  }
  assert {
    condition     = toset(keys(output.secrets)) == toset(["email-key-ring", "sign-in-signing"]) && length(output.kms) == 4 && length(output.backup_kms) == 4 && output.replication_role_arn == null
    error_message = "GLOBAL_CUSTODY: independent global custody must omit country secrets and venue replication"
  }
}
run "rejects_wrong_primary_provider" {
  command         = plan
  providers       = { aws = aws.wrong_primary, aws.backup = aws.backup }
  expect_failures = [output.kms]
}
run "rejects_crossed_provider_accounts" {
  command         = plan
  providers       = { aws = aws, aws.backup = aws.wrong_backup }
  expect_failures = [output.kms]
}
