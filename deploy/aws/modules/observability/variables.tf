variable "scope" {
  type = string
  validation {
    condition     = contains(["global", "es"], var.scope)
    error_message = "Evidence belongs only to the independent global or Spain scope"
  }
}
variable "kms_key_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9-]{36}$", var.kms_key_arn))
    error_message = "Use a complete regional symmetric log key reference without a wildcard or alias"
  }
}
variable "resources" {
  type = object({ vpc_id = string, database_identifier = string, cell_names = set(string), replication = map(object({ source_bucket = string, destination_bucket = string, rule_id = string })) })
  validation {
    condition     = !contains(["global", "es"], var.scope) || (can(regex("^vpc-[a-f0-9]{17}$", var.resources.vpc_id)) && var.resources.database_identifier == "waitron-${var.scope}" && length(var.resources.cell_names) > 0 && alltrue([for name in var.resources.cell_names : can(regex("^waitron-${var.scope}-[0-9]{2}$", name))]) && toset(keys(var.resources.replication)) == (var.scope == "es" ? toset(["stream", "snapshot"]) : toset([])) && alltrue([for v in var.resources.replication : v.rule_id == "cold"]))
    error_message = "Supply this scope's VPC, database, exact cell names and its complete country-only cold rules"
  }
}
variable "budget_limit_usd" {
  type = number
  validation {
    condition     = var.budget_limit_usd > 0
    error_message = "Supply a positive monthly budget threshold; this is an input, not a cost estimate"
  }
}
variable "retention" {
  type    = object({ operational_days = number, audit_days = number })
  default = { operational_days = 30, audit_days = 90 }
  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365], var.retention.operational_days) && var.retention.audit_days >= 1 && var.retention.audit_days <= 365 && floor(var.retention.audit_days) == var.retention.audit_days
    error_message = "Operational retention must be a supported finite CloudWatch duration and audit retention whole days from 1 through 365"
  }
}
