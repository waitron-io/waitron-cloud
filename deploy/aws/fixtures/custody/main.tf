module "custody" {
  source      = "../../modules/custody"
  providers   = { aws = aws, aws.backup = aws.backup }
  scope       = "es"
  authorities = { deployment = "arn:aws:iam::333333333333:role/waitron-es-deployment", key_administration = "arn:aws:iam::333333333333:role/waitron-es-key-administration", recovery = "arn:aws:iam::333333333333:role/waitron-es-recovery" }
  region_pair = { primary = "eu-south-2", backup = "eu-west-3" }
}
module "storage" {
  source               = "../../modules/storage"
  providers            = { aws = aws, aws.backup = aws.backup }
  scope                = "es"
  region_pair          = { primary = "eu-south-2", backup = "eu-west-3" }
  kms                  = { primary = module.custody.kms.storage, backup = module.custody.backup_kms.storage }
  replication_role_arn = module.custody.replication_role_arn
  prefixes             = { stream = "streams/", snapshot = "snapshots/" }
}
module "database" {
  source    = "../../modules/database"
  providers = { aws = aws, aws.backup = aws.backup }
  scope     = "es"
  network   = { vpc_id = "vpc-00000000000000001", database_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, service_security_group_id = "sg-00000000000000001" }
  kms       = { primary = module.custody.kms.database, backup = module.custody.backup_kms.database }
  settings  = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 }
}
module "permissions" {

  oidc_issuer       = "https://oidc.eks.eu-south-2.amazonaws.com/id/0123456789ABCDEF0123456789ABCDEF"
  namespace         = "waitron-cloud-es"
  cell_name         = "a"
  role_names        = { "api" = "api", "portal" = "portal", "registration-worker" = "registration-worker", "backup-worker" = "backup-worker", "backup-verifier" = "backup-verifier", "remote-gateway" = "remote-gateway", "remote-reconciler" = "remote-reconciler", "monitor-worker" = "monitor-worker" }
  recovery_role_arn = "arn:aws:iam::333333333333:role/waitron-es-recovery"
  prefixes          = { stream = "streams/", snapshot = "snapshots/" }

  source        = "../../modules/workload-permissions"
  providers     = { aws = aws }
  scope         = "es"
  custody_refs  = { kms = module.custody.kms, backup_kms = module.custody.backup_kms, secrets = module.custody.secrets, backup_secret_refs = module.custody.backup_secret_refs, replication_role_arn = module.custody.replication_role_arn }
  storage_refs  = module.storage.storage
  database_refs = module.database.database
}
