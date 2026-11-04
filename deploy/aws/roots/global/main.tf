module "network" {
  source    = "../../modules/network"
  providers = { aws = aws.global }
  scope     = "global"
  region    = "eu-central-1"
  network   = var.deployment.network
  cells     = var.deployment.cells
}
resource "aws_security_group" "database_clients" {
  provider = aws.global
  name     = "waitron-global-database-clients"
  vpc_id   = module.network.network.vpc_id
}
module "cell" {
  for_each                          = var.deployment.cells
  source                            = "../../modules/cell"
  providers                         = { aws = aws.global }
  cell_id                           = each.key
  kubernetes_version                = var.compute.kubernetes_version
  operator_role_arns                = var.compute.operator_role_arns
  database_client_security_group_id = aws_security_group.database_clients.id
  network = {
    vpc_id             = module.network.network.vpc_id
    private_subnet_ids = module.network.network.cells[each.key].private_subnet_ids
  }
  # Subnet creation alone does not wait for NAT routes and associations.
  depends_on = [module.network, module.observability]
}
