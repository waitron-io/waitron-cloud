# Version 1 has one role per service, so each object binds exactly one cell.
output "infrastructure_v1_by_cell" {
  value = { for name, cell in module.cell : name => {
    version = 1
    scope   = "global"
    country = null
    regions = { primary = "eu-central-1", backup = "eu-west-1" }
    cells = { (name) = {
      cluster_name           = cell.cell.cluster_name
      region                 = var.deployment.primary_region
      az_ids                 = cell.cell.az_ids
      private_subnet_ids     = values(cell.cell.private_subnet_ids)
      node_security_group_id = cell.cell.node_security_group_id
      oidc_issuer            = cell.cell.oidc_issuer
      ingress = {
        dns_name          = module.ingress[name].ingress.dns_name
        zone_id           = module.ingress[name].ingress.zone_id
        tcp_ports         = module.ingress[name].ingress.tcp_ports
        udp_ports         = module.ingress[name].ingress.udp_ports
        target_group_arns = values(module.ingress[name].ingress.target_group_arns)
      }
    } }
    database       = module.database.database
    storage        = { stream_bucket = null, snapshot_bucket = null, backup_buckets = [], kms_key_refs = {} }
    secrets        = module.custody.secrets
    workload_roles = module.workload_permissions[name].workload_roles
    observability = {
      # Stable keys fit the schema; values retain the selected cell's exact names.
      logs = {
        rds     = module.observability.observability.logs.rds
        vpc     = module.observability.observability.logs.vpc
        eks     = module.observability.observability.logs["eks/waitron-${name}"]
        metrics = module.observability.observability.logs["metrics/waitron-${name}"]
      }
      signals    = module.observability.observability.signals
      budget_ref = module.observability.observability.budget_ref
    }
    dns = module.dns.dns
    recovery = {
      region              = "eu-west-1"
      database_backup_ref = module.database.database.backup_ref
      key_refs            = module.custody.backup_kms
      secret_refs         = module.custody.backup_secret_refs
      runtime_enabled     = false
    }
    }
  }
}
