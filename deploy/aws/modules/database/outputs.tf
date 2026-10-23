locals {
  primary_region = lookup({ global = "eu-central-1", es = "eu-south-2" }, var.scope, "")
  backup_region  = lookup({ global = "eu-west-1", es = "eu-west-3" }, var.scope, "")
}
output "database" {
  value = {
    endpoint         = aws_db_instance.management.address
    port             = aws_db_instance.management.port
    name             = aws_db_instance.management.db_name
    admin_secret_ref = aws_db_instance.management.master_user_secret[0].secret_arn
    kms_key_ref      = aws_db_instance.management.kms_key_id
    backup_ref       = aws_db_instance_automated_backups_replication.cold.id
  }
  precondition {
    condition     = data.aws_region.primary.region == local.primary_region
    error_message = "The database must use its scope primary region"
  }
  precondition {
    condition     = data.aws_region.backup.region == local.backup_region
    error_message = "Cold backups must use the scope's separate destination region"
  }
  precondition {
    condition     = data.aws_caller_identity.primary.account_id == data.aws_caller_identity.backup.account_id
    error_message = "Primary and backup providers must belong to the same scope account"
  }
  precondition {
    condition     = startswith(var.kms.primary, "arn:aws:kms:${local.primary_region}:${data.aws_caller_identity.primary.account_id}:key/") && startswith(var.kms.backup, "arn:aws:kms:${local.backup_region}:${data.aws_caller_identity.primary.account_id}:key/")
    error_message = "Each encryption key must belong to the scope account and its intended region"
  }
  precondition {
    condition     = alltrue([for az in keys(var.network.database_subnet_ids) : contains(data.aws_availability_zones.primary.zone_ids, az)])
    error_message = "Every database zone must be available in the primary provider region"
  }
}
output "database_backup_ref" {
  value = aws_db_instance_automated_backups_replication.cold.id
}
