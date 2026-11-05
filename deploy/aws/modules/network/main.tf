data "aws_region" "current" {}
data "aws_availability_zones" "current" {
  state = "available"
  filter {
    name   = "zone-type"
    values = ["availability-zone"]
  }
}

locals {
  cidr        = coalesce(var.network.cidr, lookup({ global = "10.40.0.0/16", es = "10.50.0.0/16" }, var.scope, "10.50.0.0/16"))
  zones       = { for index, az in sort(distinct(var.network.az_ids)) : az => index }
  cell_blocks = { for index, name in sort(keys(var.cells)) : name => coalesce(var.cells[name].subnet_cidr, cidrsubnet(local.cidr, 4, index + 1)) }
  cell_subnets = merge({}, [for cell, block in local.cell_blocks : {
    for az, index in local.zones : "${cell}/${az}" => { az = az, cidr = cidrsubnet(block, 2, index) }
  }]...)
}

resource "aws_vpc" "primary" {
  cidr_block           = local.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
}
resource "aws_internet_gateway" "primary" { vpc_id = aws_vpc.primary.id }

resource "aws_subnet" "public" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.primary.id
  availability_zone_id    = each.key
  cidr_block              = cidrsubnet(cidrsubnet(local.cidr, 6, 0), 2, each.value)
  map_public_ip_on_launch = false
}
resource "aws_subnet" "database" {
  for_each                = local.zones
  vpc_id                  = aws_vpc.primary.id
  availability_zone_id    = each.key
  cidr_block              = cidrsubnet(cidrsubnet(local.cidr, 6, 1), 2, each.value)
  map_public_ip_on_launch = false
}
resource "aws_subnet" "cell" {
  for_each                = local.cell_subnets
  vpc_id                  = aws_vpc.primary.id
  availability_zone_id    = each.value.az
  cidr_block              = each.value.cidr
  map_public_ip_on_launch = false
}
resource "aws_eip" "zone" {
  for_each = local.zones
  domain   = "vpc"
}
resource "aws_nat_gateway" "zone" {
  for_each          = local.zones
  subnet_id         = aws_subnet.public[each.key].id
  allocation_id     = aws_eip.zone[each.key].id
  connectivity_type = "public"
  depends_on        = [aws_internet_gateway.primary]
}

resource "aws_route_table" "public" { vpc_id = aws_vpc.primary.id }
resource "aws_route" "public" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.primary.id
}
resource "aws_route_table_association" "public" {
  for_each       = local.zones
  subnet_id      = aws_subnet.public[each.key].id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table" "private" {
  for_each = local.zones
  vpc_id   = aws_vpc.primary.id
}
resource "aws_route" "private" {
  for_each               = local.zones
  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.zone[each.key].id
}
resource "aws_route_table_association" "cell" {
  for_each       = local.cell_subnets
  subnet_id      = aws_subnet.cell[each.key].id
  route_table_id = aws_route_table.private[each.value.az].id
}
resource "aws_route_table" "database" {
  for_each = local.zones
  vpc_id   = aws_vpc.primary.id
  route    = []
}
resource "aws_route_table_association" "database" {
  for_each       = local.zones
  subnet_id      = aws_subnet.database[each.key].id
  route_table_id = aws_route_table.database[each.key].id
}
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.primary.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for route in values(aws_route_table.private) : route.id]
}
