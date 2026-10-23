variable "expected_account_id" {
  type     = string
  nullable = false
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "Delegation requires one exact global account ID"
  }
}
variable "handoff" {
  type     = object({ version = number, parent_zone_id = string, child_name = string, child_name_servers = set(string) })
  nullable = false
  validation {
    condition     = var.handoff.version == 1
    error_message = "Only delegation handoff version 1 is supported"
  }
  validation {
    condition     = var.handoff.child_name == "es.waitron.io"
    error_message = "The only country delegation is exactly es.waitron.io"
  }
  validation {
    condition     = can(regex("^Z[A-Z0-9]+$", var.handoff.parent_zone_id))
    error_message = "Delegation requires an exact parent hosted-zone ID"
  }
  validation {
    condition     = length(var.handoff.child_name_servers) == 4
    error_message = "Delegation requires exactly four distinct nameservers"
  }
  validation {
    condition     = alltrue([for ns in var.handoff.child_name_servers : can(regex("^ns-[1-9][0-9]{0,3}\\.awsdns-[0-9]{1,2}\\.(com|net|org|co\\.uk)\\.?$", ns))])
    error_message = "Every nameserver must be a literal Route 53 hostname without wildcards or another suffix"
  }
  validation {
    condition     = try(length(toset([for ns in var.handoff.child_name_servers : regex("\\.(com|net|org|co\\.uk)\\.?$", ns)[0]])) == 4, true)
    error_message = "The four nameservers must cover com, net, org and co.uk"
  }
}
