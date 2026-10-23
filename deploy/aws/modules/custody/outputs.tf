output "kms" {
  value = { for purpose, key in aws_kms_key.primary : purpose => key.arn }
  precondition {
    condition     = data.aws_region.primary.region == var.region_pair.primary && data.aws_region.backup.region == var.region_pair.backup
    error_message = "Both providers must use the scope's declared regional pair"
  }
  precondition {
    condition     = data.aws_caller_identity.primary.account_id == data.aws_caller_identity.backup.account_id && alltrue([for purpose, role in var.authorities : role == "arn:aws:iam::${data.aws_caller_identity.primary.account_id}:role/waitron-${var.scope}-${replace(purpose, "_", "-")}"])
    error_message = "Both regions and every authority must belong to this scope's same account"
  }
}
output "backup_kms" { value = { for purpose, key in aws_kms_key.backup : purpose => key.arn } }
output "secrets" { value = { for purpose, secret in aws_secretsmanager_secret.application : purpose => secret.arn } }
output "backup_secret_refs" {
  value = { for purpose, secret in aws_secretsmanager_secret.application : purpose => replace(secret.arn, ":${var.region_pair.primary}:", ":${var.region_pair.backup}:") }
}
output "replication_role_arn" { value = try(aws_iam_role.replication["storage"].arn, null) }
