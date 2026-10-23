data "aws_caller_identity" "primary" {}
data "aws_caller_identity" "backup" { provider = aws.backup }
data "aws_region" "primary" {}
data "aws_region" "backup" { provider = aws.backup }
locals {
  purposes     = toset(["storage", "database", "secrets", "logs"])
  secret_names = var.scope == "global" ? toset(["email-key-ring", "sign-in-signing"]) : toset(["backup-master-key", "email-key-ring", "gateway-signing", "wireguard", "installation-signing"])
}
resource "aws_kms_key" "primary" {
  for_each                 = local.purposes
  description              = "Waitron ${var.scope} ${each.key} primary custody"
  enable_key_rotation      = true
  deletion_window_in_days  = 30
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  multi_region             = false
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "KeyAdministration", Effect = "Allow", Principal = { AWS = var.authorities.key_administration }
        Action   = ["kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:EnableKeyRotation", "kms:GetKeyRotationStatus", "kms:RotateKeyOnDemand", "kms:UpdateKeyDescription", "kms:TagResource", "kms:UntagResource", "kms:ListResourceTags", "kms:CancelKeyDeletion"]
        Resource = "*"
      },
      {
        Sid      = "DelegateScopedUse", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.primary.account_id}:root" }
        Action   = ["kms:DescribeKey", "kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:ReEncryptFrom", "kms:ReEncryptTo", "kms:CreateGrant"]
        Resource = "*"
      }
    ]
  })
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_key" "backup" {
  provider                 = aws.backup
  for_each                 = local.purposes
  description              = "Waitron ${var.scope} ${each.key} backup custody"
  enable_key_rotation      = true
  deletion_window_in_days  = 30
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  multi_region             = false
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "KeyAdministration", Effect = "Allow", Principal = { AWS = var.authorities.key_administration }
        Action   = ["kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:EnableKeyRotation", "kms:GetKeyRotationStatus", "kms:RotateKeyOnDemand", "kms:UpdateKeyDescription", "kms:TagResource", "kms:UntagResource", "kms:ListResourceTags", "kms:CancelKeyDeletion"]
        Resource = "*"
      },
      {
        Sid      = "DelegateScopedUse", Effect = "Allow", Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.primary.account_id}:root" }
        Action   = ["kms:DescribeKey", "kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:ReEncryptFrom", "kms:ReEncryptTo", "kms:CreateGrant"]
        Resource = "*"
      }
    ]
  })
  lifecycle { prevent_destroy = true }
}
resource "aws_secretsmanager_secret" "application" {
  for_each                       = local.secret_names
  name                           = "waitron-${var.scope}/${each.key}"
  kms_key_id                     = aws_kms_key.primary["secrets"].arn
  recovery_window_in_days        = 30
  force_overwrite_replica_secret = false
  replica {
    region     = var.region_pair.backup
    kms_key_id = aws_kms_key.backup["secrets"].arn
  }
  lifecycle { prevent_destroy = true }
}
resource "aws_iam_role" "replication" {
  for_each = var.scope == "es" ? toset(["storage"]) : toset([])
  name     = "waitron-${var.scope}-storage-replication"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "s3.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.primary.account_id }
        ArnEquals    = { "aws:SourceArn" = [for kind in ["stream", "snapshot"] : "arn:aws:s3:::waitron-${var.scope}-${kind}-${data.aws_caller_identity.primary.account_id}-${var.region_pair.primary}"] }
      }
    }]
  })
}
