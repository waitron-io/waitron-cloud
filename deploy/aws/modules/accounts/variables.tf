variable "existing_organization_id" {
  type    = string
  default = ""
}
variable "parent_ou_id" {
  type    = string
  default = ""
}
variable "existing_members" {
  type    = map(string)
  default = {}

  validation {
    condition     = alltrue([for scope in keys(var.existing_members) : contains(["global", "es"], scope)])
    error_message = "Existing members must use only global or es scopes"
  }

  validation {
    condition     = length(distinct(values(var.existing_members))) == length(var.existing_members)
    error_message = "Each workload scope needs a separate member account"
  }

  validation {
    condition     = alltrue([for id in values(var.existing_members) : can(regex("^[0-9]{12}$", id))])
    error_message = "Existing member references must be 12-digit account IDs"
  }
}
variable "new_members" {
  type    = map(object({ name = string }))
  default = {}

  validation {
    condition     = alltrue([for scope in keys(var.new_members) : contains(["global", "es"], scope)])
    error_message = "New members must use only global or es scopes"
  }
}
variable "contacts" {
  type      = map(string)
  sensitive = true
  default   = {}
}
