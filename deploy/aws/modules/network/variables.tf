variable "scope" {
  type = string
  validation {
    condition     = contains(["global", "es"], var.scope)
    error_message = "Primary networks must belong to global or es"
  }
}
variable "region" { type = string }
variable "network" {
  type = object({ cidr = optional(string), az_ids = list(string) })
  validation {
    condition     = length(var.network.az_ids) == 3 && length(distinct(var.network.az_ids)) == 3
    error_message = "Primary networks require exactly three distinct zone IDs"
  }
  validation {
    condition     = var.network.cidr == null ? true : try(cidrnetmask(var.network.cidr) == "255.255.0.0" && cidrhost(var.network.cidr, 0) == split("/", var.network.cidr)[0], false)
    error_message = "Primary network CIDRs must be canonical IPv4 /16 blocks"
  }
}
variable "cells" {
  type = map(object({ subnet_cidr = optional(string) }))
  validation {
    condition     = length(var.cells) > 0 && length(var.cells) <= 15
    error_message = "A primary network needs between one and fifteen cell address blocks"
  }
  validation {
    condition     = alltrue([for cell in values(var.cells) : cell.subnet_cidr == null ? true : try(cidrnetmask(cell.subnet_cidr) == "255.255.240.0" && cidrhost(cell.subnet_cidr, 0) == split("/", cell.subnet_cidr)[0], false)])
    error_message = "Cell CIDRs must be canonical IPv4 /20 blocks"
  }
}
