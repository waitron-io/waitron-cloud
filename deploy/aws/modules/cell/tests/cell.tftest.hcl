mock_provider "aws" {
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::333333333333:role/synthetic" } }
  mock_resource "aws_launch_template" { defaults = { id = "lt-00000000000000001", latest_version = 1 } }
  mock_resource "aws_security_group" { defaults = { id = "sg-00000000000000001" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  mock_resource "aws_eks_cluster" {
    defaults = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/SYNTHETIC" }] }] }
  }
}
variables {
  cell_id            = "es-01"
  kubernetes_version = "1.34"
  network = {
    vpc_id = "vpc-00000000000000001"
    private_subnet_ids = {
      eus2-az1 = "subnet-00000000000000001"
      eus2-az2 = "subnet-00000000000000002"
      eus2-az3 = "subnet-00000000000000003"
    }
  }
  operator_role_arns = ["arn:aws:iam::333333333333:role/operators/country-admin"]
}
run "one_cluster_per_cell" {
  command = plan
  override_resource {
    target = aws_security_group.control_plane
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = aws_security_group.node
    values = { id = "sg-00000000000000003" }
  }
  assert {
    condition     = aws_eks_cluster.cell.name == "waitron-es-01" && aws_eks_cluster.cell.version == "1.34" && output.cell.cluster_name == aws_eks_cluster.cell.name && output.cell.region == "eu-south-2" && output.cell.az_ids == sort(keys(var.network.private_subnet_ids)) && output.cell.private_subnet_ids == tomap(var.network.private_subnet_ids) && output.cell.node_security_group_id == aws_security_group.node.id && output.cell.oidc_issuer == aws_eks_cluster.cell.identity[0].oidc[0].issuer
    error_message = "Each cell must publish its own versioned cluster and zone bindings without credentials"
  }
}
run "one_node_per_az" {
  command = plan
  assert {
    condition     = length(aws_eks_node_group.zone) == 3 && sum([for group in values(aws_eks_node_group.zone) : group.scaling_config[0].desired_size]) == 3 && alltrue([for az, subnet in var.network.private_subnet_ids : aws_eks_node_group.zone[az].subnet_ids == toset([subnet]) && aws_eks_node_group.zone[az].scaling_config[0].min_size == 1 && aws_eks_node_group.zone[az].scaling_config[0].desired_size == 1 && aws_eks_node_group.zone[az].scaling_config[0].max_size == 1 && aws_eks_node_group.zone[az].instance_types == tolist(["t3.medium"]) && aws_eks_node_group.zone[az].capacity_type == "ON_DEMAND" && aws_eks_node_group.zone[az].cluster_name == aws_eks_cluster.cell.name && aws_eks_node_group.zone[az].version == var.kubernetes_version && aws_eks_node_group.zone[az].ami_type == "AL2023_x86_64_STANDARD"])
    error_message = "Each of three zones must have one on-demand t3.medium with fixed capacity in its own subnet"
  }
}
run "encrypted_private_nodes" {
  command = plan
  override_resource {
    target = aws_security_group.control_plane
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = aws_security_group.node
    values = { id = "sg-00000000000000003" }
  }
  assert {
    condition     = one(aws_launch_template.node.block_device_mappings).device_name == "/dev/xvda" && one(aws_launch_template.node.block_device_mappings).ebs[0].encrypted && one(aws_launch_template.node.block_device_mappings).ebs[0].volume_type == "gp3" && one(aws_launch_template.node.block_device_mappings).ebs[0].volume_size == 20 && one(aws_launch_template.node.block_device_mappings).ebs[0].delete_on_termination
    error_message = "Every node root disk must be encrypted gp3 and disposable"
  }
  assert {
    condition     = aws_launch_template.node.key_name == null && one(aws_launch_template.node.network_interfaces).associate_public_ip_address == "false" && one(aws_launch_template.node.network_interfaces).security_groups == toset([aws_security_group.node.id]) && aws_launch_template.node.metadata_options[0].http_tokens == "required" && aws_launch_template.node.metadata_options[0].http_put_response_hop_limit == 1 && aws_launch_template.node.metadata_options[0].http_endpoint == "enabled" && alltrue([for group in values(aws_eks_node_group.zone) : group.launch_template[0].id == aws_launch_template.node.id && group.launch_template[0].version == tostring(aws_launch_template.node.latest_version) && length(group.remote_access) == 0])
    error_message = "Every node must use the private IMDSv2 launch template without remote SSH access"
  }
}
run "no_implicit_admin" {
  command = plan
  override_resource {
    target = aws_security_group.control_plane
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = aws_security_group.node
    values = { id = "sg-00000000000000003" }
  }
  assert {
    condition     = aws_eks_cluster.cell.access_config[0].authentication_mode == "API" && aws_eks_cluster.cell.access_config[0].bootstrap_cluster_creator_admin_permissions == false && aws_eks_cluster.cell.vpc_config[0].endpoint_private_access && aws_eks_cluster.cell.vpc_config[0].endpoint_public_access == false && aws_eks_cluster.cell.vpc_config[0].subnet_ids == toset(values(var.network.private_subnet_ids)) && aws_eks_cluster.cell.vpc_config[0].security_group_ids == toset([aws_security_group.control_plane.id])
    error_message = "Administration must use the private endpoint and explicit API access without creator privileges"
  }
  assert {
    condition     = toset(keys(aws_eks_access_entry.operator)) == toset(var.operator_role_arns) && toset(keys(aws_eks_access_policy_association.operator)) == toset(var.operator_role_arns) && alltrue([for role in var.operator_role_arns : aws_eks_access_entry.operator[role].principal_arn == role && aws_eks_access_entry.operator[role].cluster_name == aws_eks_cluster.cell.name && aws_eks_access_entry.operator[role].type == "STANDARD" && aws_eks_access_policy_association.operator[role].principal_arn == role && aws_eks_access_policy_association.operator[role].cluster_name == aws_eks_cluster.cell.name && aws_eks_access_policy_association.operator[role].policy_arn == "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy" && aws_eks_access_policy_association.operator[role].access_scope[0].type == "cluster"])
    error_message = "Only the explicitly supplied operator roles may receive cluster administration"
  }
}
run "control_plane_audit_logs" {
  command = plan
  assert {
    condition     = aws_eks_cluster.cell.enabled_cluster_log_types == toset(["api", "audit", "authenticator", "controllerManager", "scheduler"])
    error_message = "Every control-plane log category must be enabled"
  }
}
run "service_roles_only" {
  command = plan
  assert {
    condition     = jsondecode(aws_iam_role.control_plane.assume_role_policy).Statement[0].Principal.Service == "eks.amazonaws.com" && jsondecode(aws_iam_role.node.assume_role_policy).Statement[0].Principal.Service == "ec2.amazonaws.com" && jsondecode(aws_iam_role.control_plane.assume_role_policy).Statement[0].Action == "sts:AssumeRole" && jsondecode(aws_iam_role.node.assume_role_policy).Statement[0].Action == "sts:AssumeRole" && length(jsondecode(aws_iam_role.control_plane.assume_role_policy).Statement) == 1 && length(jsondecode(aws_iam_role.node.assume_role_policy).Statement) == 1 && aws_iam_role_policy_attachment.control_plane.role == aws_iam_role.control_plane.name && alltrue([for name, binding in aws_iam_role_policy_attachment.node : binding.role == aws_iam_role.node.name && binding.policy_arn == "arn:aws:iam::aws:policy/${name}"]) && aws_iam_role_policy_attachment.control_plane.policy_arn == "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy" && toset(keys(aws_iam_role_policy_attachment.node)) == toset(["AmazonEKSWorkerNodePolicy", "AmazonEKS_CNI_Policy", "AmazonEC2ContainerRegistryPullOnly"])
    error_message = "Service roles must trust only their AWS service and carry the required managed policies"
  }
}
run "private_security_groups" {
  command = plan
  override_resource {
    target = aws_security_group.control_plane
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = aws_security_group.node
    values = { id = "sg-00000000000000003" }
  }
  assert {
    condition     = aws_security_group.node.vpc_id == var.network.vpc_id && aws_security_group.control_plane.vpc_id == var.network.vpc_id && alltrue([for rule in values(aws_vpc_security_group_ingress_rule.node_internal) : rule.security_group_id == aws_security_group.node.id && rule.referenced_security_group_id == aws_security_group.node.id && rule.cidr_ipv4 == null && rule.cidr_ipv6 == null]) && aws_vpc_security_group_ingress_rule.control_api.security_group_id == aws_security_group.control_plane.id && aws_vpc_security_group_ingress_rule.control_api.referenced_security_group_id == aws_security_group.node.id && aws_vpc_security_group_ingress_rule.control_api.from_port == 443 && aws_vpc_security_group_ingress_rule.control_api.to_port == 443 && aws_vpc_security_group_ingress_rule.control_api.ip_protocol == "tcp" && aws_vpc_security_group_ingress_rule.control_api.cidr_ipv4 == null && aws_vpc_security_group_ingress_rule.control_api.cidr_ipv6 == null && alltrue([for port in [443, 10250] : aws_vpc_security_group_ingress_rule.node_control[tostring(port)].security_group_id == aws_security_group.node.id && aws_vpc_security_group_ingress_rule.node_control[tostring(port)].referenced_security_group_id == aws_security_group.control_plane.id && aws_vpc_security_group_ingress_rule.node_control[tostring(port)].from_port == port && aws_vpc_security_group_ingress_rule.node_control[tostring(port)].to_port == port && aws_vpc_security_group_ingress_rule.node_control[tostring(port)].ip_protocol == "tcp" && aws_vpc_security_group_ingress_rule.node_control[tostring(port)].cidr_ipv4 == null && aws_vpc_security_group_ingress_rule.node_control[tostring(port)].cidr_ipv6 == null]) && aws_vpc_security_group_egress_rule.control_plane.security_group_id == aws_security_group.control_plane.id && aws_vpc_security_group_egress_rule.control_plane.referenced_security_group_id == aws_security_group.node.id && aws_vpc_security_group_egress_rule.node.security_group_id == aws_security_group.node.id && aws_vpc_security_group_egress_rule.node.cidr_ipv4 == "0.0.0.0/0"
    error_message = "Nodes and API must reject public and SSH ingress and belong to the supplied VPC"
  }
}
run "global_cell" {
  command = plan
  variables {
    cell_id = "global-01"
    network = {
      vpc_id = "vpc-00000000000000002"
      private_subnet_ids = {
        euc1-az1 = "subnet-00000000000000011"
        euc1-az2 = "subnet-00000000000000012"
        euc1-az3 = "subnet-00000000000000013"
      }
    }
  }
  override_data {
    target = data.aws_availability_zones.current
    values = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }
  }
  override_data {
    target = data.aws_region.current
    values = { region = "eu-central-1" }
  }
  assert {
    condition     = aws_eks_cluster.cell.name == "waitron-global-01" && output.cell.region == "eu-central-1"
    error_message = "The global service cell must remain separate from Spain"
  }
}
run "rejects_bad_capacity" {
  command = plan
  variables { capacity = { min = 1, desired = 3, max = 6 } }
  expect_failures = [var.capacity]
}
run "rejects_zero_capacity" {
  command = plan
  variables { capacity = { min = 0, desired = 0, max = 0 } }
  expect_failures = [var.capacity]
}
run "rejects_fractional_capacity" {
  command = plan
  variables { capacity = { min = 0.5, desired = 1, max = 1 } }
  expect_failures = [var.capacity]
}
run "rejects_two_zones" {
  command = plan
  variables { network = { vpc_id = "vpc-00000000000000001", private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002" } } }
  expect_failures = [var.network]
}
run "rejects_reused_subnet" {
  command = plan
  variables { network = { vpc_id = "vpc-00000000000000001", private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000001", eus2-az3 = "subnet-00000000000000003" } } }
  expect_failures = [var.network]
}
run "rejects_empty_vpc" {
  command = plan
  variables { network = { vpc_id = "", private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" } } }
  expect_failures = [var.network]
}
run "rejects_foreign_zone" {
  command = plan
  variables { network = { vpc_id = "vpc-00000000000000001", private_subnet_ids = { euw3-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" } } }
  expect_failures = [output.cell]
}
run "rejects_no_operator" {
  command = plan
  variables { operator_role_arns = [] }
  expect_failures = [var.operator_role_arns]
}
run "rejects_wildcard_operator" {
  command = plan
  variables { operator_role_arns = ["arn:aws:iam::333333333333:role/*"] }
  expect_failures = [var.operator_role_arns]
}
run "rejects_root_operator" {
  command = plan
  variables { operator_role_arns = ["arn:aws:iam::333333333333:root"] }
  expect_failures = [var.operator_role_arns]
}
run "rejects_foreign_operator" {
  command = plan
  variables { operator_role_arns = ["arn:aws:iam::222222222222:role/operators/global-admin"] }
  expect_failures = [output.cell]
}
run "rejects_bad_cell_name" {
  command = plan
  variables { cell_id = "other-01" }
  expect_failures = [var.cell_id]
}
run "rejects_empty_version" {
  command = plan
  variables { kubernetes_version = "" }
  expect_failures = [var.kubernetes_version]
}
run "rejects_bad_version" {
  command = plan
  variables { kubernetes_version = "latest" }
  expect_failures = [var.kubernetes_version]
}
run "rejects_wrong_region" {
  command = plan
  override_data {
    target = data.aws_region.current
    values = { region = "eu-west-3" }
  }
  expect_failures = [output.cell]
}
run "multiple_named_operators" {
  command = plan
  variables { operator_role_arns = ["arn:aws:iam::333333333333:role/operators/first", "arn:aws:iam::333333333333:role/operators/second"] }
  assert {
    condition     = length(aws_eks_access_entry.operator) == 2 && length(aws_eks_access_policy_association.operator) == 2
    error_message = "Every named operator must receive an explicit independent binding"
  }
}
run "reordered_zone_inputs" {
  command = plan
  variables {
    network = {
      vpc_id = "vpc-00000000000000001"
      private_subnet_ids = {
        eus2-az3 = "subnet-00000000000000003"
        eus2-az1 = "subnet-00000000000000001"
        eus2-az2 = "subnet-00000000000000002"
      }
    }
  }
  assert {
    condition     = alltrue([for az, subnet in var.network.private_subnet_ids : aws_eks_node_group.zone[az].node_group_name == "waitron-es-01-${az}"])
    error_message = "Node groups must retain stable zone identities"
  }
}

run "service_role_bindings" {
  command = plan
  override_resource {
    target = aws_iam_role.control_plane
    values = { arn = "arn:aws:iam::333333333333:role/synthetic-control" }
  }
  override_resource {
    target = aws_iam_role.node
    values = { arn = "arn:aws:iam::333333333333:role/synthetic-node" }
  }
  assert {
    condition     = aws_eks_cluster.cell.role_arn == "arn:aws:iam::333333333333:role/synthetic-control" && alltrue([for group in values(aws_eks_node_group.zone) : group.node_role_arn == "arn:aws:iam::333333333333:role/synthetic-node"])
    error_message = "The cluster and every node group must use their separate service roles"
  }
}

run "no_ssh_ingress" {
  command = plan
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.node_internal)) == toset(["tcp", "udp", "icmp"]) && alltrue([for rule in values(aws_vpc_security_group_ingress_rule.node_internal) : rule.ip_protocol != "-1" && (rule.ip_protocol == "icmp" || rule.from_port > 22 || rule.to_port < 22)])
    error_message = "Internal machine traffic must exclude SSH port 22 for every TCP and UDP rule"
  }
  assert {
    condition     = try(aws_vpc_security_group_ingress_rule.node_internal["tcp"].ip_protocol == "tcp" && aws_vpc_security_group_ingress_rule.node_internal["tcp"].from_port == 23 && aws_vpc_security_group_ingress_rule.node_internal["tcp"].to_port == 65535 && aws_vpc_security_group_ingress_rule.node_internal["udp"].ip_protocol == "udp" && aws_vpc_security_group_ingress_rule.node_internal["udp"].from_port == 53 && aws_vpc_security_group_ingress_rule.node_internal["udp"].to_port == 65535 && aws_vpc_security_group_ingress_rule.node_internal["icmp"].ip_protocol == "icmp" && aws_vpc_security_group_ingress_rule.node_internal["icmp"].from_port == -1 && aws_vpc_security_group_ingress_rule.node_internal["icmp"].to_port == -1, false)
    error_message = "Internal rules must retain service TCP, DNS and service UDP, and ICMP discovery without SSH"
  }
}

run "database_clients_are_actual_nodes" {
  command = plan
  variables { database_client_security_group_id = "sg-00000000000000009" }
  override_resource {
    target = aws_security_group.node
    values = { id = "sg-00000000000000003" }
  }
  assert {
    condition     = one(aws_launch_template.node.network_interfaces).security_groups == toset(["sg-00000000000000003", "sg-00000000000000009"])
    error_message = "DATABASE_CLIENT_MEMBERSHIP: every launched node must carry both its cell peer group and the explicit database-client group"
  }
}

run "rejects_malformed_database_client_group" {
  command = plan
  variables { database_client_security_group_id = "0.0.0.0/0" }
  expect_failures = [var.database_client_security_group_id]
}
run "rejects_empty_database_client_group" {
  command = plan
  variables { database_client_security_group_id = "" }
  expect_failures = [var.database_client_security_group_id]
}
