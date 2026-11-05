data "aws_region" "primary" {}
data "aws_region" "backup" { provider = aws.backup }
data "aws_caller_identity" "primary" {}
data "aws_caller_identity" "backup" { provider = aws.backup }
resource "aws_s3_bucket" "primary" {
  for_each      = local.kinds
  bucket        = "waitron-${var.scope}-${each.key}-${data.aws_caller_identity.primary.account_id}-${var.region_pair.primary}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
  object_lock_enabled = false
}
resource "aws_s3_bucket_versioning" "primary" {
  for_each = local.kinds
  bucket   = aws_s3_bucket.primary[each.key].bucket
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_public_access_block" "primary" {
  for_each                = local.kinds
  bucket                  = aws_s3_bucket.primary[each.key].bucket
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "primary" {
  for_each = local.kinds
  bucket   = aws_s3_bucket.primary[each.key].bucket
  rule {
    bucket_key_enabled       = false
    blocked_encryption_types = each.key == "stream" ? ["NONE"] : ["SSE-C"]
    apply_server_side_encryption_by_default {
      sse_algorithm     = each.key == "stream" ? "AES256" : "aws:kms"
      kms_master_key_id = each.key == "snapshot" ? var.kms.primary : null
    }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "primary" {
  for_each = local.kinds
  bucket   = aws_s3_bucket.primary[each.key].bucket
  rule {
    id     = "incomplete-uploads"
    status = "Enabled"
    filter { prefix = "" }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}
resource "aws_s3_bucket" "backup" {
  provider      = aws.backup
  for_each      = local.kinds
  bucket        = "waitron-${var.scope}-${each.key}-${data.aws_caller_identity.primary.account_id}-${var.region_pair.backup}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
  object_lock_enabled = false
}
resource "aws_s3_bucket_versioning" "backup" {
  provider = aws.backup
  for_each = local.kinds
  bucket   = aws_s3_bucket.backup[each.key].bucket
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_public_access_block" "backup" {
  provider                = aws.backup
  for_each                = local.kinds
  bucket                  = aws_s3_bucket.backup[each.key].bucket
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  provider = aws.backup
  for_each = local.kinds
  bucket   = aws_s3_bucket.backup[each.key].bucket
  rule {
    bucket_key_enabled       = false
    blocked_encryption_types = each.key == "stream" ? ["NONE"] : ["SSE-C"]
    apply_server_side_encryption_by_default {
      sse_algorithm     = each.key == "stream" ? "AES256" : "aws:kms"
      kms_master_key_id = each.key == "snapshot" ? var.kms.backup : null
    }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  provider = aws.backup
  for_each = local.kinds
  bucket   = aws_s3_bucket.backup[each.key].bucket
  rule {
    id     = "incomplete-uploads"
    status = "Enabled"
    filter { prefix = "" }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}
