data "aws_caller_identity" "primary" {}
data "aws_caller_identity" "backup" { provider = aws.backup }
data "aws_region" "primary" {}
data "aws_region" "backup" { provider = aws.backup }
locals {
  trail_arn              = "arn:aws:cloudtrail:${var.region_pair.primary}:${data.aws_caller_identity.primary.account_id}:trail/waitron-${var.scope}-audit"
  operational_log_arns   = [for name in sort(concat(["/aws/rds/instance/waitron-${var.scope}/postgresql", "/waitron/${var.scope}/vpc-flow"], [for cell in var.observability_cells : "/aws/eks/${cell}/cluster"], [for cell in var.observability_cells : "/aws/containerinsights/${cell}/performance"])) : "arn:aws:logs:${var.region_pair.primary}:${data.aws_caller_identity.primary.account_id}:log-group:${name}"]
  operational_alarm_arns = [for name in sort(concat(["database-connections", "database-storage"], [for cell in var.observability_cells : "nodes-${cell}"], var.scope == "es" ? ["replication-snapshot", "replication-stream"] : [])) : "arn:aws:cloudwatch:${var.region_pair.primary}:${data.aws_caller_identity.primary.account_id}:alarm:waitron-${var.scope}-${name}"]
  purposes               = toset(["storage", "database", "secrets", "logs"])
  secret_names           = var.scope == "global" ? toset(["email-key-ring", "sign-in-signing"]) : toset(["backup-master-key", "email-key-ring", "gateway-signing", "wireguard", "installation-signing"])
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
    Statement = concat([
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
      ], [for statement in [
        { Sid = "RegionalLogs", Effect = "Allow", Principal = { Service = "logs.${var.region_pair.primary}.amazonaws.com" }, Action = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"], Resource = "*", Condition = { ArnEquals = { "kms:EncryptionContext:aws:logs:arn" = local.operational_log_arns } } },
        { Sid = "TrailEncryption", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = ["kms:GenerateDataKey*"], Resource = "*", Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn, "kms:EncryptionContext:aws:cloudtrail:arn" = local.trail_arn } } },
        { Sid = "TrailDescribe", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = ["kms:DescribeKey"], Resource = "*", Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn } } },
        { Sid = "BudgetSignals", Effect = "Allow", Principal = { Service = "budgets.amazonaws.com" }, Action = ["kms:GenerateDataKey*", "kms:Decrypt"], Resource = "*", Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.primary.account_id }, ArnEquals = { "aws:SourceArn" = "arn:aws:budgets::${data.aws_caller_identity.primary.account_id}:budget/waitron-${var.scope}-monthly" } } },
        { Sid = "AlarmSignals", Effect = "Allow", Principal = { Service = "cloudwatch.amazonaws.com" }, Action = ["kms:GenerateDataKey*", "kms:Decrypt"], Resource = "*", Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.primary.account_id }, ArnEquals = { "aws:SourceArn" = local.operational_alarm_arns } } }
    ] : statement if each.key == "logs"])
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
