variable "scope" {
  type = string
  validation {
    condition     = var.scope == "es"
    error_message = "Venue storage belongs only to Spain, never to global"
  }
}
variable "region_pair" {
  type = object({ primary = string, backup = string })
  validation {
    condition     = var.region_pair.primary == "eu-south-2" && var.region_pair.backup == "eu-west-3"
    error_message = "Spain venue storage uses Spain as primary and Paris as its cold-copy region"
  }
}
variable "kms" {
  type = object({ primary = string, backup = string })
  validation {
    condition     = alltrue([for key in [var.kms.primary, var.kms.backup] : can(regex("^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$", key))])
    error_message = "Supply exact KMS key ARNs without aliases or wildcards"
  }
}
variable "replication_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:role/waitron-es-storage-replication$", var.replication_role_arn))
    error_message = "Use an exact Spain storage replication role ARN without paths or wildcards"
  }
}
variable "prefixes" {
  type = object({ stream = string, snapshot = string })
  validation {
    condition     = var.prefixes.stream == "streams/" && var.prefixes.snapshot == "snapshots/"
    error_message = "Preserve the exact stream and snapshot prefixes used by the country adapters"
  }
}
locals { kinds = toset(["stream", "snapshot"]) }
