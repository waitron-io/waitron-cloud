output "ingress" {
  value = {
    dns_name          = aws_lb.cell.dns_name
    zone_id           = aws_lb.cell.zone_id
    tcp_ports         = var.ports.tcp
    udp_ports         = var.ports.udp
    target_group_arns = { for key, tg in aws_lb_target_group.service : key => tg.arn }
  }
  precondition {
    condition     = !contains(["global", "es"], var.scope) || data.aws_region.current.region == lookup({ global = "eu-central-1", es = "eu-south-2" }, var.scope, "")
    error_message = "Ingress must use its scope primary region"
  }
  precondition {
    condition     = alltrue([for az in keys(var.network.public_subnet_ids) : contains(data.aws_availability_zones.current.zone_ids, az)])
    error_message = "Every ingress zone must be available in the provider region"
  }
}
