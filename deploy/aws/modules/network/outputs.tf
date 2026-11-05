output "network" {
  value = {
    vpc_id                  = aws_vpc.primary.id
    public_subnet_ids       = tomap({ for az, subnet in aws_subnet.public : az => subnet.id })
    database_subnet_ids     = tomap({ for az, subnet in aws_subnet.database : az => subnet.id })
    private_route_table_ids = tomap({ for az, table in aws_route_table.private : az => table.id })
    cells = tomap({ for cell in keys(var.cells) : cell => {
      private_subnet_ids = tomap({ for az in keys(local.zones) : az => aws_subnet.cell["${cell}/${az}"].id })
    } })
  }
  precondition {
    condition     = var.region == data.aws_region.current.region && var.region == lookup({ global = "eu-central-1", es = "eu-south-2" }, var.scope, "")
    error_message = "The provider region and scope primary region must match"
  }
  precondition {
    condition     = alltrue([for az in var.network.az_ids : contains(data.aws_availability_zones.current.zone_ids, az)])
    error_message = "Every supplied zone ID must be available in the provider region"
  }
  precondition {
    condition     = length(distinct(values(local.cell_blocks))) == length(local.cell_blocks)
    error_message = "Cell address blocks must not overlap"
  }
  precondition {
    condition     = alltrue([for block in values(local.cell_blocks) : contains([for index in range(1, 16) : cidrsubnet(local.cidr, 4, index)], block)])
    error_message = "Cell blocks must be inside the VPC outside the reserved public and database tiers"
  }
}
