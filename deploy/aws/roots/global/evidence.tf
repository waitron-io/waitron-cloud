module "observability" {
  source           = "../../modules/observability"
  providers        = { aws = aws.global }
  scope            = "global"
  kms_key_arn      = module.custody.kms.logs
  budget_limit_usd = var.budget_limit_usd
  # Producer names are deterministic so destinations do not depend on producers.
  resources = {
    vpc_id              = module.network.network.vpc_id
    database_identifier = "waitron-global"
    cell_names          = toset([for name in keys(var.deployment.cells) : "waitron-${name}"])
    replication         = {}
  }
}
