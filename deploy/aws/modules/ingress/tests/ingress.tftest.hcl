mock_provider "aws" {
  mock_resource "aws_lb" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/synthetic/1111111111111111" } }
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/2222222222222222" } }
  mock_resource "aws_security_group" { defaults = { id = "sg-22222222222222222" } }

  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
}
variables {
  scope   = "es"
  cell_id = "es-01"
  network = {
    vpc_id                 = "vpc-11111111111111111"
    public_subnet_ids      = { eus2-az1 = "subnet-11111111111111111", eus2-az2 = "subnet-22222222222222222", eus2-az3 = "subnet-33333333333333333" }
    node_security_group_id = "sg-11111111111111111"
  }
  ports = { tcp = [443], udp = [51820] }
}
run "all_three_azs_listen" {
  command = plan
  assert {
    condition     = aws_lb.cell.load_balancer_type == "network" && !aws_lb.cell.internal && aws_lb.cell.ip_address_type == "ipv4" && toset([for m in aws_lb.cell.subnet_mapping : m.subnet_id]) == toset(["subnet-11111111111111111", "subnet-22222222222222222", "subnet-33333333333333333"])
    error_message = "Public network ingress must map all three independently supplied zones"
  }
}
run "staff_tls_is_passthrough" {
  command = plan
  assert {
    condition     = aws_lb_listener.service["https"].port == 443 && aws_lb_listener.service["https"].protocol == "TCP" && aws_lb_target_group.service["https"].port == 30443 && aws_lb_target_group.service["https"].protocol == "TCP" && aws_lb_listener.service["https"].certificate_arn == null
    error_message = "Staff TLS must pass through TCP443 to TCP30443 without a certificate key"
  }
  assert {
    condition     = alltrue([for key, listener in aws_lb_listener.service : listener.load_balancer_arn == aws_lb.cell.arn && listener.default_action[0].type == "forward" && listener.default_action[0].target_group_arn == aws_lb_target_group.service[key].arn])
    error_message = "Every listener must forward through its own cell target group"
  }
}
run "wireguard_is_udp" {
  command = plan
  assert {
    condition     = aws_lb_listener.service["wireguard"].port == 51820 && aws_lb_listener.service["wireguard"].protocol == "UDP" && aws_lb_target_group.service["wireguard"].port == 31820 && aws_lb_target_group.service["wireguard"].protocol == "UDP"
    error_message = "WireGuard must remain UDP51820 to UDP31820"
  }
}
run "health_checks_and_cross_zone" {
  command = plan
  assert {
    condition     = aws_lb.cell.enable_cross_zone_load_balancing && alltrue([for tg in values(aws_lb_target_group.service) : tg.target_type == "instance" && tg.vpc_id == var.network.vpc_id && tg.preserve_client_ip && !tg.proxy_protocol_v2 && tg.load_balancing_cross_zone_enabled == "use_load_balancer_configuration" && tg.health_check[0].enabled && tg.health_check[0].protocol == "TCP" && tg.health_check[0].port == "30999" && tg.health_check[0].interval == 10 && tg.health_check[0].healthy_threshold == 3 && tg.health_check[0].unhealthy_threshold == 3])
    error_message = "Both instance targets need explicit TCP readiness checks and cross-zone paths"
  }
}
run "database_stays_private" {
  command = plan
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.public) == 2 && aws_vpc_security_group_ingress_rule.public["https"].ip_protocol == "tcp" && aws_vpc_security_group_ingress_rule.public["https"].from_port == 443 && aws_vpc_security_group_ingress_rule.public["wireguard"].ip_protocol == "udp" && aws_vpc_security_group_ingress_rule.public["wireguard"].from_port == 51820 && alltrue([for r in values(aws_vpc_security_group_ingress_rule.public) : r.from_port == r.to_port && r.cidr_ipv4 == "0.0.0.0/0" && r.cidr_ipv6 == null && r.security_group_id == aws_security_group.ingress.id])
    error_message = "Only TCP443 and UDP51820 may be public; database, API and admin ports stay private"
  }
  assert {
    condition     = toset(aws_lb.cell.security_groups) == toset([aws_security_group.ingress.id]) && aws_security_group.ingress.vpc_id == var.network.vpc_id
    error_message = "Ingress must attach its own VPC security group"
  }
}
run "node_access_is_load_balancer_only" {
  command = plan
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.node) == 3 && length(aws_vpc_security_group_egress_rule.node) == 3 && alltrue([for r in values(aws_vpc_security_group_ingress_rule.node) : r.security_group_id == var.network.node_security_group_id && r.referenced_security_group_id == aws_security_group.ingress.id && r.cidr_ipv4 == null && r.cidr_ipv6 == null && r.from_port == r.to_port]) && alltrue([for r in values(aws_vpc_security_group_egress_rule.node) : r.security_group_id == aws_security_group.ingress.id && r.referenced_security_group_id == var.network.node_security_group_id && r.cidr_ipv4 == null && r.cidr_ipv6 == null && r.from_port == r.to_port])
    error_message = "Only this load balancer may send target and readiness traffic to this cell"
  }
  assert {
    condition     = alltrue([for rules in [aws_vpc_security_group_ingress_rule.node, aws_vpc_security_group_egress_rule.node] : rules["https"].from_port == 30443 && rules["https"].ip_protocol == "tcp" && rules["wireguard"].from_port == 31820 && rules["wireguard"].ip_protocol == "udp" && rules["health"].from_port == 30999 && rules["health"].ip_protocol == "tcp"])
    error_message = "Node firewall paths must match the agreed target and readiness ports exactly"
  }
}
run "reference_only_handoff" {
  command = plan
  assert {
    condition     = output.ingress.dns_name == aws_lb.cell.dns_name && output.ingress.zone_id == aws_lb.cell.zone_id && output.ingress.tcp_ports == tolist([443]) && output.ingress.udp_ports == tolist([51820]) && toset(keys(output.ingress.target_group_arns)) == toset(["https", "wireguard"]) && alltrue([for key, arn in output.ingress.target_group_arns : arn == aws_lb_target_group.service[key].arn])
    error_message = "P1 must receive the exact ingress references and admitted public ports"
  }
}
run "global_has_no_wireguard" {
  command = plan
  variables {
    scope   = "global"
    cell_id = "global-01"
    ports   = { tcp = [443], udp = [] }
    network = {
      vpc_id                 = "vpc-22222222222222222"
      public_subnet_ids      = { euc1-az1 = "subnet-44444444444444444", euc1-az2 = "subnet-55555555555555555", euc1-az3 = "subnet-66666666666666666" }
      node_security_group_id = "sg-22222222222222222"
    }
  }
  override_data {
    target = data.aws_region.current
    values = { region = "eu-central-1" }
  }
  override_data {
    target = data.aws_availability_zones.current
    values = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }
  }
  assert {
    condition     = length(aws_lb_listener.service) == 1 && length(aws_lb_target_group.service) == 1 && length(aws_vpc_security_group_ingress_rule.public) == 1 && length(aws_vpc_security_group_ingress_rule.node) == 2 && length(aws_vpc_security_group_egress_rule.node) == 2 && output.ingress.tcp_ports == tolist([443]) && length(output.ingress.udp_ports) == 0 && toset(keys(output.ingress.target_group_arns)) == toset(["https"])
    error_message = "Global has independent TCP ingress without a country WireGuard path"
  }
}
run "rejects_public_admin_port" {
  command = plan
  variables { ports = { tcp = [443, 3000], udp = [51820] } }
  expect_failures = [var.ports]
}
run "rejects_database_port" {
  command = plan
  variables { ports = { tcp = [5432], udp = [51820] } }
  expect_failures = [var.ports]
}
run "rejects_public_api_port" {
  command = plan
  variables { ports = { tcp = [443, 6443], udp = [51820] } }
  expect_failures = [var.ports]
}
run "rejects_wrong_udp_port" {
  command = plan
  variables { ports = { tcp = [443], udp = [53] } }
  expect_failures = [var.ports]
}
run "rejects_missing_country_udp" {
  command = plan
  variables { ports = { tcp = [443], udp = [] } }
  expect_failures = [var.ports]
}
run "rejects_duplicate_ports" {
  command = plan
  variables { ports = { tcp = [443, 443], udp = [51820] } }
  expect_failures = [var.ports]
}
run "rejects_unknown_scope" {
  command = plan
  variables { scope = "fr" }
  expect_failures = [var.scope]
}
run "rejects_crossed_cell" {
  command = plan
  variables { cell_id = "global-01" }
  expect_failures = [var.cell_id]
}
run "rejects_escaped_cell" {
  command = plan
  variables { cell_id = "es-01/other" }
  expect_failures = [var.cell_id]
}
run "rejects_missing_zone" {
  command = plan
  variables {
    network = { vpc_id = "vpc-11111111111111111", node_security_group_id = "sg-11111111111111111", public_subnet_ids = { eus2-az1 = "subnet-11111111111111111", eus2-az2 = "subnet-22222222222222222" } }
  }
  expect_failures = [var.network]
}
run "rejects_duplicate_subnet" {
  command = plan
  variables {
    network = { vpc_id = "vpc-11111111111111111", node_security_group_id = "sg-11111111111111111", public_subnet_ids = { eus2-az1 = "subnet-11111111111111111", eus2-az2 = "subnet-22222222222222222", eus2-az3 = "subnet-22222222222222222" } }
  }
  expect_failures = [var.network]
}
run "rejects_unavailable_zone" {
  command = plan
  override_data {
    target = data.aws_availability_zones.current
    values = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az4"] }
  }
  expect_failures = [output.ingress]
}
run "rejects_wrong_provider_region" {
  command = plan
  override_data {
    target = data.aws_region.current
    values = { region = "eu-west-3" }
  }
  expect_failures = [output.ingress]
}
run "rejects_extra_zone_with_reused_subnet" {
  command = plan
  variables {
    network = { vpc_id = "vpc-11111111111111111", node_security_group_id = "sg-11111111111111111", public_subnet_ids = { eus2-az1 = "subnet-11111111111111111", eus2-az2 = "subnet-22222222222222222", eus2-az3 = "subnet-33333333333333333", eus2-az4 = "subnet-33333333333333333" } }
  }
  override_data {
    target = data.aws_availability_zones.current
    values = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3", "eus2-az4"] }
  }
  expect_failures = [var.network]
}
