data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
locals {
  issuer = trimprefix(var.oidc_issuer, "https://")
  role_secrets = var.scope == "global" ? {
    api = ["email-key-ring", "sign-in-signing"], portal = [], registration-worker = ["email-key-ring"], monitor-worker = ["email-key-ring"]
    } : {
    api = ["email-key-ring", "installation-signing", "gateway-signing"], portal = [], registration-worker = ["email-key-ring", "installation-signing"], backup-worker = ["backup-master-key"], backup-verifier = ["backup-master-key"], remote-gateway = ["gateway-signing", "wireguard"], remote-reconciler = ["gateway-signing"], monitor-worker = ["email-key-ring"]
  }
  runtime_secrets = { for role in keys(var.role_names) : role => [for purpose in lookup(local.role_secrets, role, []) : var.custody_refs.secrets[purpose]] if length(lookup(local.role_secrets, role, [])) > 0 }
  source_buckets  = var.storage_refs == null ? [] : ["arn:aws:s3:::${var.storage_refs.stream_bucket}", "arn:aws:s3:::${var.storage_refs.snapshot_bucket}"]
  source_objects  = var.storage_refs == null ? [] : ["arn:aws:s3:::${var.storage_refs.stream_bucket}/${var.prefixes.stream}*", "arn:aws:s3:::${var.storage_refs.snapshot_bucket}/${var.prefixes.snapshot}*"]
  backup_objects  = var.storage_refs == null ? [] : ["arn:aws:s3:::${var.storage_refs.backup_buckets.stream}/${var.prefixes.stream}*", "arn:aws:s3:::${var.storage_refs.backup_buckets.snapshot}/${var.prefixes.snapshot}*"]
}
resource "aws_iam_openid_connect_provider" "cell" {
  url            = var.oidc_issuer
  client_id_list = ["sts.amazonaws.com"]
}
resource "aws_iam_role" "workload" {
  for_each = var.role_names
  name     = "waitron-${var.scope}-${var.cell_name}-${each.key}"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRoleWithWebIdentity", Principal = { Federated = aws_iam_openid_connect_provider.cell.arn }
    Condition = { StringEquals = {
      ("${local.issuer}:aud") = "sts.amazonaws.com"
      ("${local.issuer}:sub") = "system:serviceaccount:${var.namespace}:${each.value}"
    } }
  }] })
}
resource "aws_iam_role_policy" "runtime" {
  for_each = local.runtime_secrets
  name     = "waitron-${var.scope}-${var.cell_name}-${each.key}"
  role     = aws_iam_role.workload[each.key].name
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Sid = "ReadApplicationSecrets", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = each.value },
    { Sid = "DecryptApplicationSecrets", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.custody_refs.kms.secrets, Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${local.primary_region}.amazonaws.com", "kms:EncryptionContext:SecretARN" = each.value } } }
    ], flatten([for enabled in(contains(["backup-worker", "backup-verifier"], each.key) ? [true] : []) : [
      { Sid = "SnapshotObjects", Effect = "Allow", Action = each.key == "backup-worker" ? ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"] : ["s3:GetObject"], Resource = local.source_objects[1] },
      { Sid = "SnapshotEncryption", Effect = "Allow", Action = each.key == "backup-worker" ? ["kms:Decrypt", "kms:GenerateDataKey"] : ["kms:Decrypt"], Resource = var.custody_refs.kms.storage, Condition = { StringEquals = { "kms:ViaService" = "s3.${local.primary_region}.amazonaws.com" }, StringLike = { "kms:EncryptionContext:aws:s3:arn" = local.source_objects[1] } } }
  ]])) })
}
