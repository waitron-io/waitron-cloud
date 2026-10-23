variable "scope" {
  type     = string
  nullable = false
  validation {
    condition     = contains(["global", "es"], var.scope)
    error_message = "Ingress must belong to global or es"
  }
}
variable "cell_id" {
  type     = string
  nullable = false
  validation {
    condition     = can(regex("^(global|es)-[0-9]{2}$", var.cell_id)) && startswith(var.cell_id, "${var.scope}-")
    error_message = "The exact global-NN or es-NN cell must belong to this scope"
  }
}
variable "network" {
  type     = object({ vpc_id = string, public_subnet_ids = map(string), node_security_group_id = string })
  nullable = false
  validation {
    condition     = length(var.network.public_subnet_ids) == 3 && length(distinct(values(var.network.public_subnet_ids))) == 3
    error_message = "Ingress requires exactly three distinct public subnets keyed by zone ID"
  }
}
variable "ports" {
  type     = object({ tcp = list(number), udp = list(number) })
  nullable = false
  validation {
    condition     = var.ports.tcp == tolist([443]) && var.ports.udp == (var.scope == "es" ? tolist([51820]) : tolist([]))
    error_message = "Only public TCP443 and country-only UDP51820 are admitted"
  }
}
