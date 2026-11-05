module "custody" {
  source = "../../modules/custody"
  providers = {
    aws             = aws.country
    aws.backup      = aws.country_backup
    aws.keys        = aws.country_keys
    aws.backup_keys = aws.country_backup_keys
  }
  scope       = "es"
  region_pair = { primary = "eu-south-2", backup = "eu-west-3" }
  authorities = {
    deployment         = "arn:aws:iam::${data.aws_caller_identity.country.account_id}:role/waitron-es-deployment"
    key_administration = "arn:aws:iam::${data.aws_caller_identity.country.account_id}:role/waitron-es-key-administration"
    recovery           = var.recovery_role_arn
  }
  observability_cells = toset([for name in keys(var.deployment.cells) : "waitron-${name}"])
}

module "database" {
  source    = "../../modules/database"
  providers = { aws = aws.country, aws.backup = aws.country_backup }
  scope     = "es"
  network = {
    vpc_id                    = module.network.network.vpc_id
    database_subnet_ids       = module.network.network.database_subnet_ids
    service_security_group_id = aws_security_group.database_clients.id
  }
  kms        = { primary = module.custody.kms.database, backup = module.custody.backup_kms.database }
  depends_on = [module.observability]
  settings   = var.database
}
