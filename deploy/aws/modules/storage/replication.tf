resource "aws_s3_bucket_replication_configuration" "cold" {
  for_each = local.kinds
  bucket   = aws_s3_bucket.primary[each.key].bucket
  role     = var.replication_role_arn
  depends_on = [
    aws_s3_bucket_versioning.primary, aws_s3_bucket_versioning.backup,
    aws_s3_bucket_server_side_encryption_configuration.primary, aws_s3_bucket_server_side_encryption_configuration.backup,
    aws_s3_bucket_policy.backup,
  ]
  rule {
    id       = "cold"
    priority = 1
    status   = "Enabled"
    filter { prefix = var.prefixes[each.key] }
    delete_marker_replication { status = "Disabled" }
    dynamic "source_selection_criteria" {
      for_each = each.key == "snapshot" ? [1] : []
      content {
        sse_kms_encrypted_objects { status = "Enabled" }
      }
    }
    destination {
      bucket        = "arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}"
      storage_class = "STANDARD"
      metrics { status = "Enabled" }
      dynamic "encryption_configuration" {
        for_each = each.key == "snapshot" ? [1] : []
        content { replica_kms_key_id = var.kms.backup }
      }
    }
  }
}
