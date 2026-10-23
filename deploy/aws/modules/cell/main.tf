data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "current" { state = "available" }
resource "aws_iam_role" "control_plane" {
  name               = "waitron-${var.cell_id}-control"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "eks.amazonaws.com" } }] })
}
resource "aws_iam_role" "node" {
  name               = "waitron-${var.cell_id}-node"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }] })
}
resource "aws_iam_role_policy_attachment" "control_plane" {
  role       = aws_iam_role.control_plane.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}
resource "aws_iam_role_policy_attachment" "node" {
  for_each   = toset(["AmazonEKSWorkerNodePolicy", "AmazonEKS_CNI_Policy", "AmazonEC2ContainerRegistryPullOnly"])
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/${each.key}"
}
resource "aws_security_group" "control_plane" {
  name   = "waitron-${var.cell_id}-control"
  vpc_id = var.network.vpc_id
}
resource "aws_security_group" "node" {
  name   = "waitron-${var.cell_id}-node"
  vpc_id = var.network.vpc_id
}
resource "aws_vpc_security_group_ingress_rule" "node_internal" {
  # Cell peers need service ports and path discovery while SSH stays closed.
  for_each = {
    tcp  = { protocol = "tcp", from = 23, to = 65535 }
    udp  = { protocol = "udp", from = 53, to = 65535 }
    icmp = { protocol = "icmp", from = -1, to = -1 }
  }
  security_group_id            = aws_security_group.node.id
  referenced_security_group_id = aws_security_group.node.id
  ip_protocol                  = each.value.protocol
  from_port                    = each.value.from
  to_port                      = each.value.to
}
resource "aws_vpc_security_group_ingress_rule" "control_api" {
  security_group_id            = aws_security_group.control_plane.id
  referenced_security_group_id = aws_security_group.node.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}
resource "aws_vpc_security_group_ingress_rule" "node_control" {
  for_each                     = toset(["443", "10250"])
  security_group_id            = aws_security_group.node.id
  referenced_security_group_id = aws_security_group.control_plane.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.key)
  to_port                      = tonumber(each.key)
}
resource "aws_vpc_security_group_egress_rule" "control_plane" {
  security_group_id            = aws_security_group.control_plane.id
  referenced_security_group_id = aws_security_group.node.id
  ip_protocol                  = "-1"
}
resource "aws_vpc_security_group_egress_rule" "node" {
  security_group_id = aws_security_group.node.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
resource "aws_eks_cluster" "cell" {
  name                      = "waitron-${var.cell_id}"
  role_arn                  = aws_iam_role.control_plane.arn
  version                   = var.kubernetes_version
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = false
  }
  vpc_config {
    subnet_ids              = values(var.network.private_subnet_ids)
    security_group_ids      = [aws_security_group.control_plane.id]
    endpoint_private_access = true
    endpoint_public_access  = false
  }
  depends_on = [aws_iam_role_policy_attachment.control_plane]
}
resource "aws_launch_template" "node" {
  name = "waitron-${var.cell_id}"
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      encrypted             = true
      volume_type           = "gp3"
      volume_size           = 20
      delete_on_termination = true
    }
  }
  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_endpoint               = "enabled"
  }
  network_interfaces {
    associate_public_ip_address = false
    security_groups             = concat([aws_security_group.node.id], var.database_client_security_group_id == null ? [] : [var.database_client_security_group_id])
  }
}
resource "aws_eks_node_group" "zone" {
  for_each        = var.network.private_subnet_ids
  cluster_name    = aws_eks_cluster.cell.name
  node_group_name = "waitron-${var.cell_id}-${each.key}"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = [each.value]
  version         = var.kubernetes_version
  instance_types  = ["t3.medium"]
  ami_type        = "AL2023_x86_64_STANDARD"
  capacity_type   = "ON_DEMAND"
  scaling_config {
    min_size     = var.capacity.min
    desired_size = var.capacity.desired
    max_size     = var.capacity.max
  }
  launch_template {
    id      = aws_launch_template.node.id
    version = tostring(aws_launch_template.node.latest_version)
  }
  depends_on = [aws_iam_role_policy_attachment.node]
}
resource "aws_eks_access_entry" "operator" {
  for_each      = var.operator_role_arns
  cluster_name  = aws_eks_cluster.cell.name
  principal_arn = each.value
  type          = "STANDARD"
}
resource "aws_eks_access_policy_association" "operator" {
  for_each      = var.operator_role_arns
  cluster_name  = aws_eks_cluster.cell.name
  principal_arn = each.value
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
  access_scope { type = "cluster" }
  depends_on = [aws_eks_access_entry.operator]
}
