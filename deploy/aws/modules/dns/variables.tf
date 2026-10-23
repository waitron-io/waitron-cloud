variable "scope" {
  type     = string
  nullable = false
  validation {
    condition     = contains(["global", "es"], var.scope)
    error_message = "DNS must belong to global or es"
  }
}
variable "zone_name" {
  type     = string
  nullable = false
  validation {
    condition     = !contains(["global", "es"], var.scope) || var.zone_name == lookup({ global = "waitron.io", es = "es.waitron.io" }, var.scope, "")
    error_message = "Each scope owns only its exact waitron.io zone"
  }
}
variable "create_zone" {
  type     = bool
  nullable = false
  default  = false
}
variable "existing_zone_id" {
  type    = string
  default = null
  validation {
    condition     = var.create_zone ? var.existing_zone_id == null : var.existing_zone_id != null
    error_message = "Choose explicit creation without an existing ID or adoption with an existing ID"
  }
  validation {
    condition     = var.existing_zone_id == null ? true : can(regex("^Z[A-Z0-9]+$", var.existing_zone_id))
    error_message = "An adopted zone requires one exact hosted-zone ID"
  }
}
