output "workload_roles" {
  value = { for role, value in aws_iam_role.workload : role => value.arn }
  precondition {
    condition     = data.aws_region.current.region == local.primary_region && var.recovery_role_arn == "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/waitron-${var.scope}-recovery"
    error_message = "Runtime and recovery must use the scope's own account and primary region"
  }
  precondition {
    condition     = alltrue(flatten([for side, keys in { primary = var.custody_refs.kms, backup = var.custody_refs.backup_kms } : [for key in values(keys) : can(regex("^arn:aws:kms:${side == "primary" ? local.primary_region : local.backup_region}:${data.aws_caller_identity.current.account_id}:key/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$", key))]])) && alltrue(flatten([for side, secrets in { primary = var.custody_refs.secrets, backup = var.custody_refs.backup_secret_refs } : [for ref in values(secrets) : can(regex("^arn:aws:secretsmanager:${side == "primary" ? local.primary_region : local.backup_region}:${data.aws_caller_identity.current.account_id}:secret:waitron-${var.scope}/[a-z-]+-[A-Za-z0-9]{6}$", ref))]]))
    error_message = "All keys and secret references must belong to this scope's account and their intended region"
  }
  precondition {
    condition     = var.scope == "global" ? var.storage_refs == null && var.custody_refs.replication_role_arn == null : try(var.custody_refs.replication_role_arn == "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/waitron-es-storage-replication" && var.storage_refs.stream_bucket == "waitron-es-stream-${data.aws_caller_identity.current.account_id}-eu-south-2" && var.storage_refs.snapshot_bucket == "waitron-es-snapshot-${data.aws_caller_identity.current.account_id}-eu-south-2" && var.storage_refs.backup_buckets == tomap({ stream = "waitron-es-stream-${data.aws_caller_identity.current.account_id}-eu-west-3", snapshot = "waitron-es-snapshot-${data.aws_caller_identity.current.account_id}-eu-west-3" }) && var.storage_refs.kms_key_refs == { primary = var.custody_refs.kms.storage, backup = var.custody_refs.backup_kms.storage }, false)
    error_message = "Global has no venue store; Spain must bind its exact regional stores and base replication role"
  }
  precondition {
    condition     = var.database_refs.kms_key_ref == var.custody_refs.kms.database && var.database_refs.name == "cloud_${var.scope}" && var.database_refs.port == 5432
    error_message = "Use the same scope's independently keyed management database without granting its admin secret"
  }
}
output "attachment_refs" {
  value = merge({ for role, value in aws_iam_role_policy.runtime : role => value.id }, { for role, value in aws_iam_role_policy.replication : "replication-${role}" => value.id }, { recovery = aws_iam_role_policy.recovery.id })
}
