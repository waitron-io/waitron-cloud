output "storage" {
  value = {
    stream_bucket   = aws_s3_bucket.primary["stream"].bucket
    snapshot_bucket = aws_s3_bucket.primary["snapshot"].bucket
    backup_buckets  = { for kind, bucket in aws_s3_bucket.backup : kind => bucket.bucket }
    kms_key_refs    = var.kms
  }
  precondition {
    condition     = data.aws_region.primary.region == "eu-south-2"
    error_message = "Venue storage must use the Spain primary provider"
  }
  precondition {
    condition     = data.aws_region.backup.region == "eu-west-3"
    error_message = "Cold storage must use the Paris provider"
  }
  precondition {
    condition     = data.aws_caller_identity.primary.account_id == data.aws_caller_identity.backup.account_id
    error_message = "Both regions must use the same country account"
  }
  precondition {
    condition     = var.replication_role_arn == "arn:aws:iam::${data.aws_caller_identity.primary.account_id}:role/waitron-es-storage-replication"
    error_message = "The replication role must belong to this country's account"
  }
  precondition {
    condition     = startswith(var.kms.primary, "arn:aws:kms:eu-south-2:${data.aws_caller_identity.primary.account_id}:key/") && startswith(var.kms.backup, "arn:aws:kms:eu-west-3:${data.aws_caller_identity.primary.account_id}:key/")
    error_message = "Storage keys must belong to this country and their intended region"
  }
}
