locals {
  # Planned names break the permission-to-store dependency cycle; composition checks actual names.
  storage_refs = {
    stream_bucket   = "waitron-es-stream-${data.aws_caller_identity.country.account_id}-eu-south-2"
    snapshot_bucket = "waitron-es-snapshot-${data.aws_caller_identity.country.account_id}-eu-south-2"
    backup_buckets = {
      stream   = "waitron-es-stream-${data.aws_caller_identity.country.account_id}-eu-west-3"
      snapshot = "waitron-es-snapshot-${data.aws_caller_identity.country.account_id}-eu-west-3"
    }
    kms_key_refs = { primary = module.custody.kms.storage, backup = module.custody.backup_kms.storage }
  }
}
module "storage" {
  source               = "../../modules/storage"
  providers            = { aws = aws.country, aws.backup = aws.country_backup }
  scope                = "es"
  region_pair          = { primary = "eu-south-2", backup = "eu-west-3" }
  kms                  = { primary = module.custody.kms.storage, backup = module.custody.backup_kms.storage }
  replication_role_arn = module.scope_permissions.replication_role_arn
  prefixes             = { stream = "streams/", snapshot = "snapshots/" }
}
module "scope_permissions" {
  source            = "../../modules/scope-permissions"
  providers         = { aws = aws.country }
  scope             = "es"
  recovery_role_arn = var.recovery_role_arn
  prefixes          = { stream = "streams/", snapshot = "snapshots/" }
  custody_refs = {
    kms                  = module.custody.kms
    backup_kms           = module.custody.backup_kms
    secrets              = module.custody.secrets
    backup_secret_refs   = module.custody.backup_secret_refs
    replication_role_arn = module.custody.replication_role_arn
  }
  storage_refs  = local.storage_refs
  database_refs = module.database.database
}
