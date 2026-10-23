variable "scope" {
  type = string
  validation {
    condition     = contains(["global", "es"], var.scope)
    error_message = "Use only the independent global or Spain database scope"
  }
}
variable "network" {
  type = object({ vpc_id = string, database_subnet_ids = map(string), service_security_group_id = string })
  validation {
    condition     = length(var.network.database_subnet_ids) == 3 && length(distinct(values(var.network.database_subnet_ids))) == 3
    error_message = "The database needs three distinct private subnets keyed by zone ID"
  }
  validation {
    condition     = trimspace(var.network.vpc_id) != "" && trimspace(var.network.service_security_group_id) != "" && alltrue([for subnet in values(var.network.database_subnet_ids) : trimspace(subnet) != ""])
    error_message = "The VPC, database subnets and service security group need explicit nonempty references"
  }
}
variable "kms" {
  type = object({ primary = string, backup = string })
  validation {
    condition     = alltrue([for key in [var.kms.primary, var.kms.backup] : can(regex("^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$", key))])
    error_message = "Supply exact primary and destination KMS key ARNs, without aliases or wildcards"
  }
}
variable "settings" {
  type = object({ engine_version = string, parameter_family = string, instance_class = string, allocated_storage = number, max_allocated_storage = number })
  validation {
    condition     = var.settings.allocated_storage >= 20 && var.settings.max_allocated_storage <= 100 && var.settings.max_allocated_storage >= var.settings.allocated_storage && floor(var.settings.allocated_storage) == var.settings.allocated_storage && floor(var.settings.max_allocated_storage) == var.settings.max_allocated_storage
    error_message = "Use whole GiB storage bounds from 20 to 100 with maximum at least initial storage"
  }
  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+(\\.[0-9]+)?$", var.settings.engine_version)) && var.settings.parameter_family == "postgres${split(".", var.settings.engine_version)[0]}"
    error_message = "Supply an explicit PostgreSQL version and its matching major-version parameter family"
  }
  validation {
    condition     = can(regex("^db\\.[a-z0-9]+\\.[a-z0-9]+$", var.settings.instance_class))
    error_message = "Supply an explicit RDS database instance class"
  }
}
variable "retention" {
  type    = object({ primary = number, backup = number })
  default = { primary = 7, backup = 7 }
  validation {
    condition     = alltrue([for days in [var.retention.primary, var.retention.backup] : days >= 1 && days <= 35 && floor(days) == days])
    error_message = "Primary and destination retention must each be a whole number of days from 1 to 35"
  }
}
