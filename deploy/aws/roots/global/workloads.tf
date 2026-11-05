module "workload_permissions" {
  for_each          = var.deployment.cells
  source            = "../../modules/workload-permissions"
  providers         = { aws = aws.global }
  scope             = "global"
  cell_name         = each.key
  oidc_issuer       = module.cell[each.key].cell.oidc_issuer
  namespace         = "waitron-cloud-global"
  role_names        = { "api" = "api", "portal" = "portal", "registration-worker" = "registration-worker", "monitor-worker" = "monitor-worker" }
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
