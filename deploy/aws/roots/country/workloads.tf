module "workload_permissions" {
  for_each          = var.deployment.cells
  source            = "../../modules/workload-permissions"
  providers         = { aws = aws.country }
  scope             = "es"
  cell_name         = each.key
  oidc_issuer       = module.cell[each.key].cell.oidc_issuer
  namespace         = "waitron-cloud-es"
  role_names        = { "api" = "api", "portal" = "portal", "registration-worker" = "registration-worker", "backup-worker" = "backup-worker", "backup-verifier" = "backup-verifier", "remote-gateway" = "remote-gateway", "remote-reconciler" = "remote-reconciler", "monitor-worker" = "monitor-worker" }
  recovery_role_arn = var.recovery_role_arn
  prefixes          = { stream = "streams/", snapshot = "snapshots/" }
  custody_refs = {
    kms                  = module.custody.kms
    backup_kms           = module.custody.backup_kms
    secrets              = module.custody.secrets
    backup_secret_refs   = module.custody.backup_secret_refs
    replication_role_arn = module.custody.replication_role_arn
  }
  # The root storage output verifies that actual stores equal these policy targets.
  storage_refs  = local.storage_refs
  database_refs = module.database.database
}
