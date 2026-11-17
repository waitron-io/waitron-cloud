module "ingress" {
  for_each  = var.deployment.cells
  source    = "../../modules/ingress"
  providers = { aws = aws.global }
  scope     = "global"
  cell_id   = each.key
  network = {
    vpc_id                 = module.network.network.vpc_id
    public_subnet_ids      = module.network.network.public_subnet_ids
    node_security_group_id = module.cell[each.key].cell.node_security_group_id
  }
  ports = { tcp = [443], udp = [] }
}
module "dns" {
  source           = "../../modules/dns"
  providers        = { aws = aws.global }
  scope            = "global"
  zone_name        = "waitron.io"
  create_zone      = var.dns.create_zone
  existing_zone_id = var.dns.existing_zone_id
}
resource "aws_route53_record" "console" {
  for_each = toset(["waitron.io", "console.waitron.io"])
  provider = aws.global
  zone_id  = module.dns.dns.zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = module.ingress[sort(keys(var.deployment.cells))[0]].ingress.dns_name
    zone_id                = module.ingress[sort(keys(var.deployment.cells))[0]].ingress.zone_id
    evaluate_target_health = true
  }
}
