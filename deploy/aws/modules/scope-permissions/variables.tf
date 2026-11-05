variable "scope" {
  type = string
  validation {
    condition     = contains(["global", "es"], var.scope)
    error_message = "Use only the independent global or Spain scope"
  }
}
variable "prefixes" {
  type = object({ stream = string, snapshot = string })
  validation {
    condition     = var.prefixes.stream == "streams/" && var.prefixes.snapshot == "snapshots/"
    error_message = "Preserve the exact adapter stream and snapshot prefixes"
  }
}
variable "recovery_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/waitron-${var.scope}-recovery$", var.recovery_role_arn))
    error_message = "Supply one exact scope recovery role"
  }
}
variable "custody_refs" {
  type = object({ kms = map(string), backup_kms = map(string), secrets = map(string), backup_secret_refs = map(string), replication_role_arn = string })
  validation {
    condition     = toset(keys(var.custody_refs.kms)) == toset(["storage", "database", "secrets", "logs"]) && toset(keys(var.custody_refs.backup_kms)) == toset(["storage", "database", "secrets", "logs"]) && toset(keys(var.custody_refs.secrets)) == toset(var.scope == "global" ? ["email-key-ring", "sign-in-signing"] : ["backup-master-key", "email-key-ring", "gateway-signing", "wireguard", "installation-signing"]) && toset(keys(var.custody_refs.backup_secret_refs)) == toset(keys(var.custody_refs.secrets))
    error_message = "Use complete closed primary and backup custody references"
  }
}
variable "storage_refs" {
  type    = object({ stream_bucket = string, snapshot_bucket = string, backup_buckets = map(string), kms_key_refs = object({ primary = string, backup = string }) })
  default = null
}
variable "database_refs" {
  type = object({ endpoint = string, port = number, name = string, admin_secret_ref = string, kms_key_ref = string, backup_ref = string })
}
locals {
  primary_region = lookup({ global = "eu-central-1", es = "eu-south-2" }, var.scope, "")
  backup_region  = lookup({ global = "eu-west-1", es = "eu-west-3" }, var.scope, "")
}
