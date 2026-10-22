mock_provider "aws" {
  alias = "state"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-south-2:333333333333:key/00000000-0000-4000-8000-000000000003" }
  }
}
variables {
  scope               = "es"
  home_region         = "eu-south-2"
  expected_account_id = "333333333333"
  deployment_roles = {
    state      = "arn:aws:iam::333333333333:role/tofu-state"
    country    = "arn:aws:iam::333333333333:role/tofu-country"
    delegation = "arn:aws:iam::333333333333:role/tofu-delegation"
  }
  recovery_role_arn = "arn:aws:iam::333333333333:role/state-recovery"
}

run "country_state_custody_is_separate" {
  command = plan
  assert {
    condition     = output.custody == { bucket_name = "waitron-es-state-333333333333", kms_key_ref = "arn:aws:kms:eu-south-2:333333333333:key/00000000-0000-4000-8000-000000000003", region = "eu-south-2" }
    error_message = "The root must expose only Spain custody references"
  }
}

mock_provider "aws" {
  alias = "global"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-central-1:222222222222:key/00000000-0000-4000-8000-000000000001" } }
}
run "global_custody_stays_in_its_account" {
  command   = plan
  providers = { aws.state = aws.global }
  variables {
    scope               = "global"
    home_region         = "eu-central-1"
    expected_account_id = "222222222222"
    deployment_roles    = { state = "arn:aws:iam::222222222222:role/tofu-state", global = "arn:aws:iam::222222222222:role/tofu-global", delegation = "arn:aws:iam::222222222222:role/tofu-delegation" }
    recovery_role_arn   = "arn:aws:iam::222222222222:role/state-recovery"
  }
  assert {
    condition     = output.custody.bucket_name == "waitron-global-state-222222222222" && output.custody.region == "eu-central-1"
    error_message = "global state must stay in its own account and home region"
  }
}

mock_provider "aws" {
  alias = "administration"
  mock_data "aws_caller_identity" { defaults = { account_id = "111111111111" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-central-1:111111111111:key/00000000-0000-4000-8000-000000000001" } }
}
run "administration_custody_stays_in_its_account" {
  command   = plan
  providers = { aws.state = aws.administration }
  variables {
    scope               = "administration"
    home_region         = "eu-central-1"
    expected_account_id = "111111111111"
    deployment_roles    = { accounts = "arn:aws:iam::111111111111:role/tofu-accounts", state = "arn:aws:iam::111111111111:role/tofu-state" }
    recovery_role_arn   = "arn:aws:iam::111111111111:role/state-recovery"
  }
  assert {
    condition     = output.custody.bucket_name == "waitron-administration-state-111111111111" && output.custody.region == "eu-central-1"
    error_message = "administration state must stay in its own account and home region"
  }
}
