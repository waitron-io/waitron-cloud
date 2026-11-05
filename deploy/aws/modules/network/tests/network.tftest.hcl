mock_provider "aws" {
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_data "aws_availability_zones" {
    defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }
  }
}
variables {
  scope   = "es"
  region  = "eu-south-2"
  network = { az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }
  cells   = { es-01 = {} }
}
run "three_independent_paths" {
  command = plan
  assert {
    condition     = length(output.network.public_subnet_ids) == 3 && length(output.network.database_subnet_ids) == 3 && length(output.network.private_route_table_ids) == 3 && length(output.network.cells) == 1
    error_message = "A primary network requires three public, database and private zone paths"
  }
}

run "zone_resources_and_routes" {


















  command = plan
  assert {
    condition     = length(aws_nat_gateway.zone) == 3 && length(aws_eip.zone) == 3 && length(aws_subnet.public) == 3 && length(aws_subnet.database) == 3 && length(aws_subnet.cell) == 3
    error_message = "Each zone needs a public, database and cell subnet plus a NAT gateway and Elastic IP"
  }
  assert {
    condition     = alltrue([for az in var.network.az_ids : aws_nat_gateway.zone[az].subnet_id == aws_subnet.public[az].id && aws_nat_gateway.zone[az].allocation_id == aws_eip.zone[az].id && aws_nat_gateway.zone[az].connectivity_type == "public"])
    error_message = "Each NAT must use its own zone public subnet and Elastic IP"
  }
  assert {
    condition     = alltrue([for az in var.network.az_ids : aws_subnet.public[az].availability_zone_id == az && aws_subnet.database[az].availability_zone_id == az && aws_subnet.cell["es-01/${az}"].availability_zone_id == az])
    error_message = "Public, database and private subnets must be keyed by actual zone IDs"
  }
  assert {
    condition     = alltrue([for az in var.network.az_ids : aws_route.private[az].nat_gateway_id == aws_nat_gateway.zone[az].id && aws_route.private[az].route_table_id == aws_route_table.private[az].id && aws_route.private[az].destination_cidr_block == "0.0.0.0/0"])
    error_message = "Private default routes must use their own zone NAT"
  }
  assert {
    condition     = alltrue([for az in var.network.az_ids : aws_route_table_association.cell["es-01/${az}"].subnet_id == aws_subnet.cell["es-01/${az}"].id && aws_route_table_association.cell["es-01/${az}"].route_table_id == aws_route_table.private[az].id])
    error_message = "Each cell subnet must attach to its own zone private route table"
  }
  assert {
    condition     = aws_internet_gateway.primary.vpc_id == aws_vpc.primary.id && aws_route.public.gateway_id == aws_internet_gateway.primary.id && aws_route.public.destination_cidr_block == "0.0.0.0/0" && aws_route.public.route_table_id == aws_route_table.public.id && alltrue([for az in var.network.az_ids : aws_route_table_association.public[az].route_table_id == aws_route_table.public.id && aws_route_table_association.public[az].subnet_id == aws_subnet.public[az].id])
    error_message = "Public subnets need their VPC internet gateway"
  }
  assert {
    condition     = alltrue([for subnet in concat(values(aws_subnet.public), values(aws_subnet.database), values(aws_subnet.cell)) : subnet.vpc_id == aws_vpc.primary.id && subnet.map_public_ip_on_launch == false]) && alltrue([for table in concat([aws_route_table.public], values(aws_route_table.private), values(aws_route_table.database)) : table.vpc_id == aws_vpc.primary.id]) && alltrue([for eip in values(aws_eip.zone) : eip.domain == "vpc"])
    error_message = "All network paths must belong to this VPC without automatic public instance IPs"
  }
  assert {
    condition     = aws_vpc.primary.enable_dns_support && aws_vpc.primary.enable_dns_hostnames
    error_message = "The primary VPC must resolve service names"
  }
  assert {
    condition     = output.network.vpc_id == aws_vpc.primary.id && alltrue([for az in var.network.az_ids : output.network.public_subnet_ids[az] == aws_subnet.public[az].id && output.network.database_subnet_ids[az] == aws_subnet.database[az].id && output.network.private_route_table_ids[az] == aws_route_table.private[az].id && output.network.cells["es-01"].private_subnet_ids[az] == aws_subnet.cell["es-01/${az}"].id])
    error_message = "Network consumers must receive the actual resource references by zone ID"
  }
}
run "database_has_no_internet_default" {
  command = plan
  assert {
    condition     = length(aws_route_table.database) == 3 && alltrue([for az in var.network.az_ids : length(aws_route_table.database[az].route) == 0 && aws_route_table_association.database[az].subnet_id == aws_subnet.database[az].id && aws_route_table_association.database[az].route_table_id == aws_route_table.database[az].id])
    error_message = "Database subnets need explicit isolated route tables without internet defaults"
  }
}
run "regional_s3_avoids_nat" {
  command = plan
  assert {
    condition     = aws_vpc_endpoint.s3.service_name == "com.amazonaws.eu-south-2.s3" && aws_vpc_endpoint.s3.vpc_endpoint_type == "Gateway" && aws_vpc_endpoint.s3.vpc_id == aws_vpc.primary.id && toset(aws_vpc_endpoint.s3.route_table_ids) == toset([for table in values(aws_route_table.private) : table.id])
    error_message = "Private zone routes need their own regional S3 gateway endpoint"
  }
}
run "spain_carves_disjoint_subnets" {
  command = plan
  assert {
    condition     = aws_vpc.primary.cidr_block == "10.50.0.0/16" && [for az in var.network.az_ids : aws_subnet.public[az].cidr_block] == ["10.50.0.0/24", "10.50.1.0/24", "10.50.2.0/24"] && [for az in var.network.az_ids : aws_subnet.database[az].cidr_block] == ["10.50.4.0/24", "10.50.5.0/24", "10.50.6.0/24"] && [for az in var.network.az_ids : aws_subnet.cell["es-01/${az}"].cidr_block] == ["10.50.16.0/22", "10.50.20.0/22", "10.50.24.0/22"]
    error_message = "Spain tiers and the first cell must use deterministic disjoint CIDRs"
  }
}
run "global_carves_disjoint_subnets" {
  command = plan
  variables {
    scope   = "global"
    region  = "eu-central-1"
    network = { az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }
    cells   = { global-01 = {} }
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
    condition     = aws_vpc.primary.cidr_block == "10.40.0.0/16" && aws_subnet.public["euc1-az1"].cidr_block == "10.40.0.0/24" && aws_subnet.database["euc1-az1"].cidr_block == "10.40.4.0/24" && aws_subnet.cell["global-01/euc1-az1"].cidr_block == "10.40.16.0/22" && aws_vpc_endpoint.s3.service_name == "com.amazonaws.eu-central-1.s3"
    error_message = "Global must use a network disjoint from Spain in its own region"
  }
}
run "more_cells_share_only_zone_nat" {
  command = plan
  variables { cells = { es-01 = {}, es-02 = { subnet_cidr = "10.50.32.0/20" } } }
  assert {
    condition     = length(aws_subnet.cell) == 6 && length(aws_nat_gateway.zone) == 3 && length(output.network.cells) == 2 && aws_subnet.cell["es-02/eus2-az1"].cidr_block == "10.50.32.0/22" && alltrue([for az in var.network.az_ids : aws_route_table_association.cell["es-02/${az}"].route_table_id == aws_route_table.private[az].id])
    error_message = "A second cell must get three disjoint subnets and reuse each zone NAT path"
  }
}

run "surviving_az_routes" {
  command = plan
  assert {
    condition     = alltrue([for az in var.network.az_ids : aws_route.private[az].nat_gateway_id == aws_nat_gateway.zone[az].id && aws_nat_gateway.zone[az].subnet_id == aws_subnet.public[az].id && aws_route_table_association.cell["es-01/${az}"].route_table_id == aws_route_table.private[az].id])
    error_message = "Every zone must retain its declared private route, NAT and subnet bindings"
  }
}
run "zone_input_order_preserves_subnets" {
  command = plan
  variables { network = { az_ids = ["eus2-az3", "eus2-az1", "eus2-az2"] } }
  assert {
    condition     = aws_subnet.public["eus2-az1"].cidr_block == "10.50.0.0/24" && aws_subnet.public["eus2-az3"].cidr_block == "10.50.2.0/24" && aws_subnet.cell["es-01/eus2-az1"].cidr_block == "10.50.16.0/22"
    error_message = "Reordering zone inputs cannot reassign a subnet CIDR"
  }
}

run "rejects_duplicate_az" {
  command = plan
  variables { network = { az_ids = ["eus2-az1", "eus2-az1", "eus2-az3"] } }
  expect_failures = [var.network]
}

run "rejects_two_zones" {
  command = plan
  variables { network = { az_ids = ["eus2-az1", "eus2-az2"] } }
  expect_failures = [var.network]
}

run "rejects_four_zones" {
  command = plan
  variables { network = { az_ids = ["eus2-az1", "eus2-az2", "eus2-az3", "eus2-az4"] } }
  expect_failures = [var.network]
}

run "rejects_foreign_zone" {
  command = plan
  variables { network = { az_ids = ["eus2-az1", "eus2-az2", "euc1-az3"] } }
  expect_failures = [output.network]
}

run "rejects_wrong_region" {
  command = plan
  variables { region = "eu-west-3" }
  expect_failures = [output.network]
}

run "rejects_wrong_scope_region" {
  command = plan
  variables { region = "eu-west-3" }
  override_data {
    target = data.aws_region.current
    values = { region = "eu-west-3" }
  }
  expect_failures = [output.network]
}

run "rejects_unknown_scope" {
  command = plan
  variables { scope = "fr" }
  expect_failures = [var.scope]
}

run "rejects_overlapping_subnets" {
  command = plan
  variables { cells = { es-01 = {}, es-02 = { subnet_cidr = "10.50.16.0/20" } } }
  expect_failures = [output.network]
}

run "rejects_outside_vpc" {
  command = plan
  variables { cells = { es-01 = { subnet_cidr = "10.60.16.0/20" } } }
  expect_failures = [output.network]
}

run "rejects_reserved_tiers" {
  command = plan
  variables { cells = { es-01 = { subnet_cidr = "10.50.0.0/20" } } }
  expect_failures = [output.network]
}

run "rejects_malformed_vpc" {
  command = plan
  variables { network = { cidr = "not-a-cidr", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  expect_failures = [var.network]
}

run "rejects_noncanonical_vpc" {
  command = plan
  variables { network = { cidr = "10.50.1.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  expect_failures = [var.network]
}

run "rejects_wrong_vpc_size" {
  command = plan
  variables { network = { cidr = "10.50.0.0/20", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  expect_failures = [var.network]
}

run "rejects_ipv6_vpc" {
  command = plan
  variables { network = { cidr = "fd00::/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  expect_failures = [var.network]
}

run "rejects_malformed_cell" {
  command = plan
  variables { cells = { es-01 = { subnet_cidr = "not-a-cidr" } } }
  expect_failures = [var.cells]
}

run "rejects_noncanonical_cell" {
  command = plan
  variables { cells = { es-01 = { subnet_cidr = "10.50.17.0/20" } } }
  expect_failures = [var.cells]
}

run "rejects_wrong_cell_size" {
  command = plan
  variables { cells = { es-01 = { subnet_cidr = "10.50.16.0/21" } } }
  expect_failures = [var.cells]
}

run "rejects_no_cells" {
  command = plan
  variables { cells = {} }
  expect_failures = [var.cells]
}

run "rejects_too_many_cells" {
  command = plan
  variables { cells = { for i in range(16) : format("es-%02d", i + 1) => {} } }
  expect_failures = [var.cells]
}
