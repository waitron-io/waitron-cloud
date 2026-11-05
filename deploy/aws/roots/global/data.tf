module "custody" {
  source = "../../modules/custody"
  providers = {
    aws             = aws.global
    aws.backup      = aws.global_backup
    aws.keys        = aws.global_keys
    aws.backup_keys = aws.global_backup_keys
  }
  scope       = "global"
  region_pair = { primary = "eu-central-1", backup = "eu-west-1" }
  authorities = {
    deployment         = "arn:aws:iam::${data.aws_caller_identity.global.account_id}:role/waitron-global-deployment"
    key_administration = "arn:aws:iam::${data.aws_caller_identity.global.account_id}:role/waitron-global-key-administration"
    recovery           = var.recovery_role_arn
  }
  observability_cells = toset([for name in keys(var.deployment.cells) : "waitron-${name}"])
}

module "database" {
  source    = "../../modules/database"
  providers = { aws = aws.global, aws.backup = aws.global_backup }
  scope     = "global"
  network = {
    vpc_id                    = module.network.network.vpc_id
    database_subnet_ids       = module.network.network.database_subnet_ids
    service_security_group_id = aws_security_group.database_clients.id
  }
  kms        = { primary = module.custody.kms.database, backup = module.custody.backup_kms.database }
  depends_on = [module.observability]
  settings   = var.database
}
