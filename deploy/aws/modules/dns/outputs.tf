output "dns" {
  value = {
    zone_id      = local.zone_id
    name         = var.create_zone ? aws_route53_zone.managed[0].name : trimsuffix(data.aws_route53_zone.existing[0].name, ".")
    name_servers = local.name_servers
  }
  precondition {
    condition     = !contains(["global", "es"], var.scope) || data.aws_region.current.region == lookup({ global = "eu-central-1", es = "eu-south-2" }, var.scope, "")
    error_message = "DNS administration must stay bound to its scope home region"
  }
  precondition {
    condition     = var.create_zone || !can(regex("^Z[A-Z0-9]+$", var.existing_zone_id)) || var.existing_zone_id == local.zone_id
    error_message = "The public zone lookup must match the explicitly supplied adoption ID"
  }
}
