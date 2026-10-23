variable "scope" {
  type = string
  validation {
    condition     = contains(["global", "es"], var.scope)
    error_message = "Custody belongs only to the independent global or Spain account"
  }
}
variable "region_pair" {
  type = object({ primary = string, backup = string })
  validation {
    condition     = var.region_pair == lookup({ global = { primary = "eu-central-1", backup = "eu-west-1" }, es = { primary = "eu-south-2", backup = "eu-west-3" } }, var.scope, { primary = "", backup = "" })
    error_message = "Use the scope's exact primary and cold-copy region pair"
  }
}
variable "authorities" {
  type = object({ deployment = string, key_administration = string, recovery = string })
  validation {
    condition     = length(distinct(values(var.authorities))) == 3 && alltrue([for purpose, arn in var.authorities : can(regex("^arn:aws:iam::[0-9]{12}:role/waitron-${var.scope}-${replace(purpose, "_", "-")}$", arn))])
    error_message = "Supply three distinct exact scope roles for deployment, key administration and recovery"
  }
}

variable "observability_cells" {
  type    = set(string)
  default = []
  validation {
    condition     = !contains(["global", "es"], var.scope) || alltrue([for name in var.observability_cells : can(regex("^waitron-${var.scope}-[0-9]{2}$", name))])
    error_message = "Log key contexts require exact cell names in this scope"
  }
}
