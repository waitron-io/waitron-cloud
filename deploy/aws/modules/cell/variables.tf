variable "cell_id" {
  type = string
  validation {
    condition     = can(regex("^(global|es)-[0-9]{2}$", var.cell_id))
    error_message = "A cell must have a stable global-NN or es-NN name"
  }
}
variable "kubernetes_version" {
  type = string
  validation {
    condition     = can(regex("^1\\.[0-9]{2}$", var.kubernetes_version))
    error_message = "Supply an explicit Kubernetes major.minor version"
  }
}
variable "network" {
  type = object({ vpc_id = string, private_subnet_ids = map(string) })
  validation {
    condition     = length(var.network.private_subnet_ids) == 3 && length(distinct(values(var.network.private_subnet_ids))) == 3
    error_message = "A cell needs three distinct private subnets keyed by zone ID"
  }
  validation {
    condition     = trimspace(var.network.vpc_id) != "" && alltrue([for subnet in values(var.network.private_subnet_ids) : trimspace(subnet) != ""])
    error_message = "The VPC and every subnet need explicit nonempty references"
  }
}
variable "operator_role_arns" {
  type = set(string)
  validation {
    condition     = length(var.operator_role_arns) > 0 && alltrue([for role in var.operator_role_arns : can(regex("^arn:aws:iam::[0-9]{12}:role/([A-Za-z0-9_+=,.@-]+/)*[A-Za-z0-9_+=,.@-]+$", role))])
    error_message = "Name at least one exact operator IAM role without wildcards or root principals"
  }
}
variable "capacity" {
  type    = object({ min = number, desired = number, max = number })
  default = { min = 1, desired = 1, max = 1 }
  validation {
    condition     = var.capacity.min == 1 && var.capacity.desired == 1 && var.capacity.max == 1
    error_message = "Each zone group must remain fixed at one node until growth is separately qualified"
  }
}

variable "database_client_security_group_id" {
  type    = string
  default = null
  validation {
    condition     = var.database_client_security_group_id == null ? true : can(regex("^sg-[0-9a-f]{17}$", var.database_client_security_group_id))
    error_message = "Supply an exact database-client security group ID or omit it for a standalone cell"
  }
}
