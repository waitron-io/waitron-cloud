module "scope_permissions" {
  source            = "../../modules/scope-permissions"
  providers         = { aws = aws.global }
  scope             = "global"
  recovery_role_arn = var.recovery_role_arn
  prefixes          = { stream = "streams/", snapshot = "snapshots/" }
  custody_refs = {
    kms                  = module.custody.kms
    backup_kms           = module.custody.backup_kms
    secrets              = module.custody.secrets
    backup_secret_refs   = module.custody.backup_secret_refs
    replication_role_arn = module.custody.replication_role_arn
  }
  storage_refs  = null
  database_refs = module.database.database
}
