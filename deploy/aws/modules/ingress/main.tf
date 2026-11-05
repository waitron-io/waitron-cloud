data "aws_region" "current" {}
data "aws_availability_zones" "current" { state = "available" }
locals {
  services   = merge({ https = { port = 443, target = 30443, protocol = "TCP" } }, var.scope == "es" ? { wireguard = { port = 51820, target = 31820, protocol = "UDP" } } : {})
  node_paths = merge(local.services, { health = { port = 30999, target = 30999, protocol = "TCP" } })
}
# Standalone rules own the paths; empty inline lists would revoke those rules.
resource "aws_security_group" "ingress" {
  name   = "waitron-${var.cell_id}-ingress"
  vpc_id = var.network.vpc_id
}
resource "aws_vpc_security_group_ingress_rule" "public" {
  for_each          = local.services
  security_group_id = aws_security_group.ingress.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = lower(each.value.protocol)
  from_port         = each.value.port
  to_port           = each.value.port
}
# Public target and readiness traffic must come through this NLB even with client IP preservation.
resource "aws_vpc_security_group_ingress_rule" "node" {
  for_each                     = local.node_paths
  security_group_id            = var.network.node_security_group_id
  referenced_security_group_id = aws_security_group.ingress.id
  ip_protocol                  = lower(each.value.protocol)
  from_port                    = each.value.target
  to_port                      = each.value.target
}
resource "aws_vpc_security_group_egress_rule" "node" {
  for_each                     = local.node_paths
  security_group_id            = aws_security_group.ingress.id
  referenced_security_group_id = var.network.node_security_group_id
  ip_protocol                  = lower(each.value.protocol)
  from_port                    = each.value.target
  to_port                      = each.value.target
}
resource "aws_lb" "cell" {
  name                             = "waitron-${var.cell_id}"
  load_balancer_type               = "network"
  internal                         = false
  ip_address_type                  = "ipv4"
  security_groups                  = [aws_security_group.ingress.id]
  enable_cross_zone_load_balancing = true
  dynamic "subnet_mapping" {
    for_each = var.network.public_subnet_ids
    content { subnet_id = subnet_mapping.value }
  }
}
resource "aws_lb_target_group" "service" {
  for_each                          = local.services
  name                              = "waitron-${var.cell_id}-${each.key}"
  target_type                       = "instance"
  vpc_id                            = var.network.vpc_id
  port                              = each.value.target
  protocol                          = each.value.protocol
  preserve_client_ip                = true
  proxy_protocol_v2                 = false
  load_balancing_cross_zone_enabled = "use_load_balancer_configuration"
  health_check {
    enabled             = true
    protocol            = "TCP"
    port                = "30999"
    interval            = 10
    healthy_threshold   = 3
    unhealthy_threshold = 3
  }
}
resource "aws_lb_listener" "service" {
  for_each          = local.services
  load_balancer_arn = aws_lb.cell.arn
  port              = each.value.port
  protocol          = each.value.protocol
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }
}
