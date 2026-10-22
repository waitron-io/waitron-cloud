output "cell" {
  value = {
    cluster_name           = aws_eks_cluster.cell.name
    region                 = data.aws_region.current.region
    az_ids                 = sort(keys(var.network.private_subnet_ids))
    private_subnet_ids     = var.network.private_subnet_ids
    node_security_group_id = aws_security_group.node.id
    oidc_issuer            = aws_eks_cluster.cell.identity[0].oidc[0].issuer
  }
  precondition {
    condition     = alltrue([for az in keys(var.network.private_subnet_ids) : contains(data.aws_availability_zones.current.zone_ids, az)])
    error_message = "Every cell zone must be available in the provider region"
  }
  precondition {
    condition     = alltrue([for role in var.operator_role_arns : try(split(":", role)[4] == data.aws_caller_identity.current.account_id, false)])
    error_message = "Operator roles must belong to the cell account"
  }
  precondition {
    condition     = data.aws_region.current.region == lookup({ global = "eu-central-1", es = "eu-south-2" }, split("-", var.cell_id)[0], "")
    error_message = "The cell must use its scope primary region"
  }
}
