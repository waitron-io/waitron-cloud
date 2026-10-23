variable "deployment" {
  type     = object({ version = number, scope = string, country = string, primary_region = string, backup_region = string, network = object({ cidr = string, az_ids = list(string) }), cells = map(object({ subnet_cidr = string })) })
  nullable = false
  validation {
    condition     = var.deployment.version == 1
    error_message = "Only deployment version 1 is supported"
  }
  validation {
    condition     = var.deployment.scope == "country"
    error_message = "Use only this independent root scope"
  }
  validation {
    condition     = var.deployment.country == "es"
    error_message = "The country discriminator must match this root"
  }
  validation {
    condition     = var.deployment.primary_region == "eu-south-2" && var.deployment.backup_region == "eu-west-3"
    error_message = "Use the exact primary and cold-copy region pair"
  }
  validation {
    condition     = alltrue([for cell in keys(var.deployment.cells) : can(regex("^es-[0-9]{2}$", cell))])
    error_message = "Every cell name must belong to this scope"
  }
}
variable "bindings" {
  type     = map(object({ expected_identity = string, role_arn = string }))
  nullable = false
  validation {
    condition     = toset(keys(var.bindings)) == toset(["country", "country_backup", "country_keys", "country_backup_keys"])
    error_message = "Supply exactly this scope's four deployment and key-administration bindings"
  }
  validation {
    condition     = alltrue([for binding in values(var.bindings) : can(regex("^[0-9]{12}$", binding.expected_identity))])
    error_message = "Every binding needs an exact twelve-digit account identity"
  }
  validation {
    condition     = length(distinct([for binding in values(var.bindings) : binding.expected_identity])) == 1
    error_message = "Every regional and key-administration alias must belong to the same scope account"
  }
  validation {
    condition     = alltrue([for name, binding in var.bindings : binding.role_arn == "arn:aws:iam::${binding.expected_identity}:role/waitron-es-${endswith(name, "_keys") ? "key-administration" : "deployment"}"])
    error_message = "Bind deployment and key administration to their distinct exact same-account roles"
  }
}
