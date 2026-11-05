data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
locals {
  bucket_name   = "waitron-${var.scope}-state-${var.expected_account_id}"
  bucket_arn    = "arn:aws:s3:::${local.bucket_name}"
  state_objects = { for root, role in var.deployment_roles : root => "${local.bucket_arn}/${var.scope}/${root}/terraform.tfstate" }
}
resource "aws_kms_key" "state" {
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      { Sid = "Recovery", Effect = "Allow", Principal = { AWS = var.recovery_role_arn }, Action = "kms:*", Resource = "*" }
      ], [for root, role in var.deployment_roles : {
        Sid      = "Deploy${title(root)}", Effect = "Allow", Principal = { AWS = role }
        Action   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = "*"
        Condition = { StringEquals = {
          "kms:ViaService"                   = "s3.${var.home_region}.amazonaws.com"
          "kms:EncryptionContext:aws:s3:arn" = [local.state_objects[root], "${local.state_objects[root]}.tflock"]
        } }
    }])
  })
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket" "state" {
  bucket        = local.bucket_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    bucket_key_enabled = false
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
  }
}
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [local.bucket_arn, "${local.bucket_arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
      { Sid = "DenyForeignPrincipals", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [local.bucket_arn, "${local.bucket_arn}/*"], Condition = { ArnNotEquals = { "aws:PrincipalArn" = concat(values(var.deployment_roles), [var.recovery_role_arn]) } } },
      { Sid = "DenyStateDeletion", Effect = "Deny", Principal = { AWS = values(var.deployment_roles) }, Action = ["s3:DeleteObject", "s3:DeleteObjectVersion"], Resource = values(local.state_objects) },
      { Sid = "DenyWrongKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "${local.bucket_arn}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = aws_kms_key.state.arn } } },
      { Sid = "RecoveryRead", Effect = "Allow", Principal = { AWS = var.recovery_role_arn }, Action = ["s3:GetObject", "s3:GetObjectVersion"], Resource = "${local.bucket_arn}/*" },
      { Sid = "RecoveryList", Effect = "Allow", Principal = { AWS = var.recovery_role_arn }, Action = ["s3:ListBucket", "s3:ListBucketVersions"], Resource = local.bucket_arn }
      ], flatten([for root, role in var.deployment_roles : [
        { Sid = "State${title(root)}", Effect = "Allow", Principal = { AWS = role }, Action = ["s3:GetObject", "s3:PutObject"], Resource = local.state_objects[root] },
        { Sid = "Lock${title(root)}", Effect = "Allow", Principal = { AWS = role }, Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${local.state_objects[root]}.tflock" },
        { Sid = "List${title(root)}", Effect = "Allow", Principal = { AWS = role }, Action = "s3:ListBucket", Resource = local.bucket_arn, Condition = { StringEquals = { "s3:prefix" = ["${var.scope}/${root}/terraform.tfstate", "${var.scope}/${root}/terraform.tfstate.tflock"] } } },
        { Sid = "DenyOutside${title(root)}", Effect = "Deny", Principal = { AWS = role }, Action = "s3:*", NotResource = [local.bucket_arn, local.state_objects[root], "${local.state_objects[root]}.tflock"] },
        { Sid = "DenyList${title(root)}", Effect = "Deny", Principal = { AWS = role }, Action = "s3:ListBucket", Resource = local.bucket_arn, Condition = { StringNotEquals = { "s3:prefix" = ["${var.scope}/${root}/terraform.tfstate", "${var.scope}/${root}/terraform.tfstate.tflock"] } } }
    ]]))
  })
}
