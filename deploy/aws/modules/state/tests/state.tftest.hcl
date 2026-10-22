mock_provider "aws" {
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

run "versioning_is_enabled" {
  command = plan
  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "State versions must survive replacement writes"
  }
}

run "public_access_is_blocked" {
  command = plan
  assert {
    condition     = aws_s3_bucket_public_access_block.state.block_public_acls && aws_s3_bucket_public_access_block.state.block_public_policy && aws_s3_bucket_public_access_block.state.ignore_public_acls && aws_s3_bucket_public_access_block.state.restrict_public_buckets
    error_message = "Every public access block must be enabled"
  }
}

run "state_uses_its_own_kms_key" {
  command = plan
  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "aws:kms" && one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default[0].kms_master_key_id == aws_kms_key.state.arn
    error_message = "State must use its own KMS key"
  }
}

run "bucket_cannot_be_force_destroyed" {
  command = plan
  assert {
    condition     = aws_s3_bucket.state.force_destroy == false
    error_message = "State bucket destruction cannot delete retained versions"
  }
}

run "kms_key_rotation_is_enabled" {
  command = plan
  assert {
    condition     = aws_kms_key.state.enable_key_rotation
    error_message = "State KMS rotation must be enabled"
  }
}

run "tls_is_required" {
  command = plan
  assert {
    condition     = try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "DenyInsecureTransport"]) == { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [local.bucket_arn, "${local.bucket_arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }, false)
    error_message = "TLS denial must cover the bucket and every object"
  }
}

run "roles_only_touch_their_own_root" {
  command = plan
  assert {
    condition     = alltrue([for root, role in var.deployment_roles : try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "State${title(root)}"]) == { Sid = "State${title(root)}", Effect = "Allow", Principal = { AWS = role }, Action = ["s3:GetObject", "s3:PutObject"], Resource = local.state_objects[root] }, false)])
    error_message = "Each role may read and write only its exact root state"
  }
}

run "lock_permissions_are_exact" {
  command = plan
  assert {
    condition     = alltrue([for root, role in var.deployment_roles : try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "Lock${title(root)}"]) == { Sid = "Lock${title(root)}", Effect = "Allow", Principal = { AWS = role }, Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${local.state_objects[root]}.tflock" }, false)])
    error_message = "Lock deletion must be limited to the matching lock object"
  }
}

run "list_permissions_are_exact" {
  command = plan
  assert {
    condition     = alltrue([for root, role in var.deployment_roles : try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "List${title(root)}"]) == { Sid = "List${title(root)}", Effect = "Allow", Principal = { AWS = role }, Action = "s3:ListBucket", Resource = local.bucket_arn, Condition = { StringEquals = { "s3:prefix" = ["${var.scope}/${root}/terraform.tfstate", "${var.scope}/${root}/terraform.tfstate.tflock"] } } }, false)])
    error_message = "Bucket listing must be limited to each root state and lock"
  }
}

run "foreign_roles_are_denied" {
  command = plan
  assert {
    condition     = try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "DenyForeignPrincipals"]) == { Sid = "DenyForeignPrincipals", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [local.bucket_arn, "${local.bucket_arn}/*"], Condition = { ArnNotEquals = { "aws:PrincipalArn" = concat(values(var.deployment_roles), [var.recovery_role_arn]) } } }, false)
    error_message = "Foreign roles must have an explicit bucket denial"
  }
}

run "kms_access_is_bound_to_state_objects" {
  command = plan
  assert {
    condition     = alltrue([for root, role in var.deployment_roles : try(one([for s in jsondecode(aws_kms_key.state.policy).Statement : s if s.Sid == "Deploy${title(root)}"]) == { Sid = "Deploy${title(root)}", Effect = "Allow", Principal = { AWS = role }, Action = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"], Resource = "*", Condition = { StringEquals = { "kms:ViaService" = "s3.${var.home_region}.amazonaws.com", "kms:EncryptionContext:aws:s3:arn" = [local.state_objects[root], "${local.state_objects[root]}.tflock"] } } }, false)])
    error_message = "Deployment key use must match the home S3 service and exact state or lock context"
  }
}

run "explicitly_denies_sibling_root_access" {
  command = plan
  assert {
    condition     = alltrue([for root, role in var.deployment_roles : try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "DenyOutside${title(root)}"]) == { Sid = "DenyOutside${title(root)}", Effect = "Deny", Principal = { AWS = role }, Action = "s3:*", NotResource = [local.bucket_arn, local.state_objects[root], "${local.state_objects[root]}.tflock"] }, false)])
    error_message = "Existing IAM grants cannot allow sibling state objects"
  }
}

run "explicitly_denies_state_deletion" {
  command = plan
  assert {
    condition     = try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "DenyStateDeletion"]) == { Sid = "DenyStateDeletion", Effect = "Deny", Principal = { AWS = values(var.deployment_roles) }, Action = ["s3:DeleteObject", "s3:DeleteObjectVersion"], Resource = values(local.state_objects) }, false)
    error_message = "Deployment roles cannot delete current or historical state"
  }
}

run "explicitly_denies_sibling_listing" {
  command = plan
  assert {
    condition     = alltrue([for root, role in var.deployment_roles : try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "DenyList${title(root)}"]) == { Sid = "DenyList${title(root)}", Effect = "Deny", Principal = { AWS = role }, Action = "s3:ListBucket", Resource = local.bucket_arn, Condition = { StringNotEquals = { "s3:prefix" = ["${var.scope}/${root}/terraform.tfstate", "${var.scope}/${root}/terraform.tfstate.tflock"] } } }, false)])
    error_message = "Existing IAM grants cannot list sibling roots"
  }
}

run "rejects_wrong_encryption_headers" {
  command = plan
  assert {
    condition     = try(one([for s in jsondecode(aws_s3_bucket_policy.state.policy).Statement : s if s.Sid == "DenyWrongKey"]) == { Sid = "DenyWrongKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "${local.bucket_arn}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.state.arn } } }, false)
    error_message = "Backend writes must name the exact state KMS key"
  }
}

run "rejects_unknown_scope" {
  command = plan
  variables { scope = "fr" }
  expect_failures = [var.scope]
}

run "rejects_wrong_region" {
  command = plan
  variables { home_region = "eu-west-3" }
  expect_failures = [output.custody]
}

run "rejects_malformed_account" {
  command = plan
  variables { expected_account_id = "invalid" }
  expect_failures = [var.expected_account_id]
}

run "rejects_wrong_account" {
  command         = plan
  providers       = { aws = aws.foreign_account }
  expect_failures = [output.custody]
}

run "rejects_global_root_in_country" {
  command = plan
  variables { deployment_roles = { global = "arn:aws:iam::333333333333:role/tofu-global" } }
  expect_failures = [output.custody]
}

run "rejects_organization_root_in_country" {
  command = plan
  variables { deployment_roles = { accounts = "arn:aws:iam::333333333333:role/tofu-accounts" } }
  expect_failures = [output.custody]
}

run "rejects_foreign_deployment_role" {
  command = plan
  variables { deployment_roles = { country = "arn:aws:iam::222222222222:role/tofu-country" } }
  expect_failures = [output.custody]
}

run "rejects_wildcard_deployment_role" {
  command = plan
  variables { deployment_roles = { country = "arn:aws:iam::333333333333:role/*" } }
  expect_failures = [var.deployment_roles]
}

run "rejects_shared_root_role" {
  command = plan
  variables { deployment_roles = { state = "arn:aws:iam::333333333333:role/tofu-shared", country = "arn:aws:iam::333333333333:role/tofu-shared" } }
  expect_failures = [var.deployment_roles]
}

run "rejects_no_deployment_roles" {
  command = plan
  variables { deployment_roles = {} }
  expect_failures = [var.deployment_roles]
}

run "rejects_foreign_recovery_role" {
  command = plan
  variables { recovery_role_arn = "arn:aws:iam::222222222222:role/recovery" }
  expect_failures = [output.custody]
}

run "rejects_wildcard_recovery_role" {
  command = plan
  variables { recovery_role_arn = "arn:aws:iam::333333333333:role/*" }
  expect_failures = [var.recovery_role_arn]
}

run "rejects_recovery_as_deployment_role" {
  command = plan
  variables { recovery_role_arn = "arn:aws:iam::333333333333:role/tofu-country" }
  expect_failures = [output.custody]
}

mock_provider "aws" {
  alias = "global"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-central-1:222222222222:key/00000000-0000-4000-8000-000000000001" } }
}
run "global_custody_stays_in_its_account" {
  command   = plan
  providers = { aws = aws.global }
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
  providers = { aws = aws.administration }
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

mock_provider "aws" {
  alias = "foreign_account"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-south-2:333333333333:key/00000000-0000-4000-8000-000000000003" } }
}
