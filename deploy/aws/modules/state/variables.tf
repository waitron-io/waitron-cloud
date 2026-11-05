variable "scope" {
  type = string
  validation {
    condition     = contains(["administration", "global", "es"], var.scope)
    error_message = "State custody must belong to administration, global or es"
  }
}
variable "home_region" {
  type = string
}
variable "expected_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "State account IDs must have 12 digits"
  }
}

variable "deployment_roles" {
  type = map(string)
  validation {
    condition     = alltrue([for role in values(var.deployment_roles) : can(regex("^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_-]+(/[A-Za-z0-9+=,.@_-]+)*$", role))])
    error_message = "Deployment roles must be exact IAM role references without wildcards"
  }
  validation {
    condition     = length(distinct(values(var.deployment_roles))) == length(var.deployment_roles)
    error_message = "Each root needs a separate deployment role"
  }
  validation {
    condition     = length(var.deployment_roles) > 0
    error_message = "State custody requires deployment roles"
  }
}

variable "recovery_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_-]+(/[A-Za-z0-9+=,.@_-]+)*$", var.recovery_role_arn))
    error_message = "Recovery requires an exact role reference without wildcards"
  }
}
