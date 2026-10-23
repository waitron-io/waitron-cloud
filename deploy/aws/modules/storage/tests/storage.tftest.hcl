mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}
mock_provider "aws" {
  alias = "backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
}
variables {
  scope       = "es"
  region_pair = { primary = "eu-south-2", backup = "eu-west-3" }
  kms = {
    primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111"
    backup  = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222"
  }
  replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication"
  prefixes             = { stream = "streams/", snapshot = "snapshots/" }
}
run "stream_accepts_sse_c" {
  command = plan
  assert {
    condition     = try(alltrue([for config in [aws_s3_bucket_server_side_encryption_configuration.primary["stream"], aws_s3_bucket_server_side_encryption_configuration.backup["stream"]] : one(config.rule).blocked_encryption_types == tolist(["NONE"]) && !one(config.rule).bucket_key_enabled && one(one(config.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"]), false)
    error_message = "Both stream buckets must explicitly accept customer-key encryption without requiring a KMS upload header"
  }
  assert {
    condition     = try(alltrue([for policy in [aws_s3_bucket_policy.primary["stream"], aws_s3_bucket_policy.backup["stream"]] : length(jsondecode(policy.policy).Statement) == 2 && alltrue([for statement in jsondecode(policy.policy).Statement : !can(statement.Condition.StringNotEquals["s3:x-amz-server-side-encryption"]) && !can(statement.Condition.StringNotEquals["s3:x-amz-server-side-encryption-aws-kms-key-id"])])]), false)
    error_message = "Stream policies must not reject customer-key uploads with KMS-header requirements"
  }
}
run "snapshot_versions_survive" {
  command = plan
  assert {
    condition     = try(alltrue([for config in concat(values(aws_s3_bucket_versioning.primary), values(aws_s3_bucket_versioning.backup)) : one(config.versioning_configuration).status == "Enabled"]), false)
    error_message = "All primary and cold-copy buckets must retain object versions"
  }
  assert {
    condition     = try(alltrue([for bucket in concat(values(aws_s3_bucket.primary), values(aws_s3_bucket.backup)) : !bucket.force_destroy && bucket.object_lock_enabled != true]), false)
    error_message = "No bucket may force-delete objects or enable irreversible Object Lock"
  }
  assert {
    condition     = try(one(one(aws_s3_bucket_server_side_encryption_configuration.primary["snapshot"].rule).apply_server_side_encryption_by_default).kms_master_key_id == var.kms.primary && one(one(aws_s3_bucket_server_side_encryption_configuration.backup["snapshot"].rule).apply_server_side_encryption_by_default).kms_master_key_id == var.kms.backup && alltrue([for config in [aws_s3_bucket_server_side_encryption_configuration.primary["snapshot"], aws_s3_bucket_server_side_encryption_configuration.backup["snapshot"]] : one(one(config.rule).apply_server_side_encryption_by_default).sse_algorithm == "aws:kms" && !one(config.rule).bucket_key_enabled && one(config.rule).blocked_encryption_types == tolist(["SSE-C"])]), false)
    error_message = "Snapshots must default to their exact regional key without bucket-level encryption contexts"
  }
}
run "private_tls_only_buckets" {
  command = plan
  assert {
    condition     = try(alltrue([for block in concat(values(aws_s3_bucket_public_access_block.primary), values(aws_s3_bucket_public_access_block.backup)) : block.block_public_acls && block.block_public_policy && block.ignore_public_acls && block.restrict_public_buckets]), false)
    error_message = "Every primary and backup bucket must block every form of public access"
  }
  assert {
    condition     = try(alltrue([for policy in concat(values(aws_s3_bucket_policy.primary), values(aws_s3_bucket_policy.backup)) : jsondecode(policy.policy).Version == "2012-10-17" && one([for s in jsondecode(policy.policy).Statement : s if s.Sid == "DenyInsecureTransport"]) == { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = ["arn:aws:s3:::${policy.bucket}", "arn:aws:s3:::${policy.bucket}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }]), false)
    error_message = "Actual policy JSON must deny all insecure bucket and object requests"
  }
}
run "paris_encrypted_replication" {
  command = plan
  assert {
    condition     = try(alltrue([for kind, config in aws_s3_bucket_replication_configuration.cold : config.bucket == aws_s3_bucket.primary[kind].bucket && config.role == var.replication_role_arn && length(config.rule) == 1 && one(config.rule).status == "Enabled" && one(config.rule).priority == 1 && one(one(config.rule).filter).prefix == var.prefixes[kind] && one(one(config.rule).destination).bucket == "arn:aws:s3:::${aws_s3_bucket.backup[kind].bucket}" && one(one(config.rule).destination).storage_class == "STANDARD" && one(one(config.rule).delete_marker_replication).status == "Disabled"]), false)
    error_message = "Each source must copy only its own prefix to the corresponding Paris Standard bucket using the exact role, without delete markers"
  }
  assert {
    condition     = try(one(one(one(aws_s3_bucket_replication_configuration.cold["snapshot"].rule).destination).encryption_configuration).replica_kms_key_id == var.kms.backup && one(one(one(aws_s3_bucket_replication_configuration.cold["snapshot"].rule).source_selection_criteria).sse_kms_encrypted_objects).status == "Enabled" && length(one(aws_s3_bucket_replication_configuration.cold["stream"].rule).source_selection_criteria) == 0 && length(one(one(aws_s3_bucket_replication_configuration.cold["stream"].rule).destination).encryption_configuration) == 0, false)
    error_message = "KMS snapshots need an explicit destination key and opt-in; customer-key streams must keep their encryption"
  }
}
run "no_age_only_snapshot_deletion" {
  command = plan
  assert {
    condition     = try(alltrue([for config in concat(values(aws_s3_bucket_lifecycle_configuration.primary), values(aws_s3_bucket_lifecycle_configuration.backup)) : length(config.rule) == 1 && one(config.rule).status == "Enabled" && one(one(config.rule).abort_incomplete_multipart_upload).days_after_initiation == 7 && length(one(config.rule).expiration) == 0 && length(one(config.rule).noncurrent_version_expiration) == 0 && length(one(config.rule).transition) == 0 && length(one(config.rule).noncurrent_version_transition) == 0 && one(one(config.rule).filter).prefix == ""]), false)
    error_message = "Bucket lifecycle may only abort incomplete uploads after seven days, never delete or transition completed versions"
  }
}
run "rejects_cross_scope_or_wildcard_grant" {
  command = plan
  assert {
    condition     = try(alltrue([for policy in concat(values(aws_s3_bucket_policy.primary), values(aws_s3_bucket_policy.backup)) : alltrue([for s in jsondecode(policy.policy).Statement : s.Effect == "Deny"]) && one([for s in jsondecode(policy.policy).Statement : s if s.Sid == "DenyForeignPrincipals"]) == { Sid = "DenyForeignPrincipals", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = ["arn:aws:s3:::${policy.bucket}", "arn:aws:s3:::${policy.bucket}/*"], Condition = { StringNotEquals = { "aws:PrincipalAccount" = "333333333333" } } }]), false)
    error_message = "Bucket policies must deny foreign accounts and never grant wildcard or cross-scope access"
  }
  assert {
    condition     = try(alltrue([for policy in [aws_s3_bucket_policy.primary["snapshot"], aws_s3_bucket_policy.backup["snapshot"]] : length(jsondecode(policy.policy).Statement) == 5 && alltrue([for sid in ["DenyWrongEncryption", "DenyWrongKey", "DenyCustomerKey"] : length([for s in jsondecode(policy.policy).Statement : s if s.Sid == sid]) == 1])]), false)
    error_message = "Snapshot policies must reject explicit encryption overrides without rejecting default-encrypted uploads"
  }
}
run "snapshots_use_default_key_without_allowing_overrides" {
  command = plan
  assert {
    condition = try(alltrue([for side, policy in { primary = aws_s3_bucket_policy.primary["snapshot"], backup = aws_s3_bucket_policy.backup["snapshot"] } : alltrue([
      one([for s in jsondecode(policy.policy).Statement : s if s.Sid == "DenyWrongEncryption"]) == { Sid = "DenyWrongEncryption", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${policy.bucket}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" }, Null = { "s3:x-amz-server-side-encryption" = "false" } } },
      one([for s in jsondecode(policy.policy).Statement : s if s.Sid == "DenyWrongKey"]) == { Sid = "DenyWrongKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${policy.bucket}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = var.kms[side] }, Null = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = "false" } } },
      one([for s in jsondecode(policy.policy).Statement : s if s.Sid == "DenyCustomerKey"]) == { Sid = "DenyCustomerKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${policy.bucket}/*", Condition = { Null = { "s3:x-amz-server-side-encryption-customer-algorithm" = "false" } } }
    ])]), false)
    error_message = "Snapshot uploads without encryption headers must use the regional default; explicit other keys, algorithms and customer keys must be denied"
  }
}
run "storage_handoff" {
  command = plan
  assert {
    condition     = try(output.storage == { stream_bucket = aws_s3_bucket.primary["stream"].bucket, snapshot_bucket = aws_s3_bucket.primary["snapshot"].bucket, backup_buckets = { stream = aws_s3_bucket.backup["stream"].bucket, snapshot = aws_s3_bucket.backup["snapshot"].bucket }, kms_key_refs = var.kms } && aws_s3_bucket.primary["stream"].bucket == "waitron-es-stream-333333333333-eu-south-2" && aws_s3_bucket.primary["snapshot"].bucket == "waitron-es-snapshot-333333333333-eu-south-2" && aws_s3_bucket.backup["stream"].bucket == "waitron-es-stream-333333333333-eu-west-3" && aws_s3_bucket.backup["snapshot"].bucket == "waitron-es-snapshot-333333333333-eu-west-3", false)
    error_message = "The handoff must bind country-specific primary and backup names and regional key references"
  }
}
run "no_global_venue_storage" {
  command = plan
  variables { scope = "global" }
  expect_failures = [var.scope]
}
run "rejects_wildcard_prefix" {
  command = plan
  variables { prefixes = { stream = "*", snapshot = "snapshots/" } }
  expect_failures = [var.prefixes]
}
run "rejects_crossed_prefix" {
  command = plan
  variables { prefixes = { stream = "global/", snapshot = "snapshots/" } }
  expect_failures = [var.prefixes]
}
run "rejects_snapshot_prefix_escape" {
  command = plan
  variables { prefixes = { stream = "streams/", snapshot = "../global/" } }
  expect_failures = [var.prefixes]
}
run "rejects_wildcard_role" {
  command = plan
  variables { replication_role_arn = "arn:aws:iam::333333333333:role/*" }
  expect_failures = [var.replication_role_arn]
}
run "rejects_foreign_role" {
  command = plan
  variables { replication_role_arn = "arn:aws:iam::222222222222:role/waitron-es-storage-replication" }
  expect_failures = [output.storage]
}
run "rejects_wrong_role_scope" {
  command = plan
  variables { replication_role_arn = "arn:aws:iam::333333333333:role/waitron-global-storage-replication" }
  expect_failures = [var.replication_role_arn]
}
run "rejects_crossed_accounts" {
  command = plan
  override_data {
    target = data.aws_caller_identity.backup
    values = { account_id = "222222222222" }
  }
  expect_failures = [output.storage]
}
run "rejects_wrong_primary_region" {
  command = plan
  override_data {
    target = data.aws_region.primary
    values = { region = "eu-west-3" }
  }
  expect_failures = [output.storage]
}
run "rejects_wrong_backup_region" {
  command = plan
  override_data {
    target = data.aws_region.backup
    values = { region = "eu-west-1" }
  }
  expect_failures = [output.storage]
}
run "rejects_reversed_region_input" {
  command = plan
  variables { region_pair = { primary = "eu-west-3", backup = "eu-south-2" } }
  expect_failures = [var.region_pair]
}
run "rejects_foreign_primary_key" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-south-2:222222222222:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [output.storage]
}
run "rejects_foreign_backup_key" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:222222222222:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [output.storage]
}
run "rejects_key_in_wrong_region" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-west-3:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [output.storage]
}
run "rejects_primary_key_for_backup" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-south-2:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [output.storage]
}
run "rejects_wildcard_key" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-south-2:333333333333:key/*", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [var.kms]
}
