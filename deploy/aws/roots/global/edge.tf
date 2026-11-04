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
