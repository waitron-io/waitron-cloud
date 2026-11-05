module "observability" {
  source           = "../../modules/observability"
  providers        = { aws = aws.country }
  scope            = "es"
  kms_key_arn      = module.custody.kms.logs
  budget_limit_usd = var.budget_limit_usd
  # Producer names are deterministic so destinations do not depend on producers.
  resources = {
    vpc_id              = module.network.network.vpc_id
    database_identifier = "waitron-es"
    cell_names          = toset([for name in keys(var.deployment.cells) : "waitron-${name}"])
    replication = { for kind in ["stream", "snapshot"] : kind => {
      source_bucket      = kind == "stream" ? local.storage_refs.stream_bucket : local.storage_refs.snapshot_bucket
      destination_bucket = local.storage_refs.backup_buckets[kind]
      rule_id            = "cold"
    } }
  }
}
