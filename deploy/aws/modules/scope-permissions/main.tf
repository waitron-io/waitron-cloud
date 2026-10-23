data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
locals {
  source_buckets = var.storage_refs == null ? [] : ["arn:aws:s3:::${var.storage_refs.stream_bucket}", "arn:aws:s3:::${var.storage_refs.snapshot_bucket}"]
  source_objects = var.storage_refs == null ? [] : ["arn:aws:s3:::${var.storage_refs.stream_bucket}/${var.prefixes.stream}*", "arn:aws:s3:::${var.storage_refs.snapshot_bucket}/${var.prefixes.snapshot}*"]
  backup_objects = var.storage_refs == null ? [] : ["arn:aws:s3:::${var.storage_refs.backup_buckets.stream}/${var.prefixes.stream}*", "arn:aws:s3:::${var.storage_refs.backup_buckets.snapshot}/${var.prefixes.snapshot}*"]
}
resource "aws_iam_role_policy" "replication" {
  for_each = var.scope == "es" ? toset(["storage"]) : toset([])
  name     = "waitron-${var.scope}-replication"
  role     = reverse(split("/", var.custody_refs.replication_role_arn))[0]
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "ReadSourceMetadata", Effect = "Allow", Action = ["s3:GetReplicationConfiguration", "s3:ListBucket"], Resource = local.source_buckets },
    { Sid = "ReadSourceVersions", Effect = "Allow", Action = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"], Resource = local.source_objects },
    { Sid = "WriteCopies", Effect = "Allow", Action = ["s3:ReplicateObject", "s3:ReplicateTags"], Resource = local.backup_objects },
    { Sid = "DecryptSource", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.custody_refs.kms.storage, Condition = { StringEquals = { "kms:ViaService" = "s3.${local.primary_region}.amazonaws.com" }, StringLike = { "kms:EncryptionContext:aws:s3:arn" = local.source_objects[1] } } },
    { Sid = "EncryptCopies", Effect = "Allow", Action = ["kms:Encrypt"], Resource = var.custody_refs.backup_kms.storage, Condition = { StringEquals = { "kms:ViaService" = "s3.${local.backup_region}.amazonaws.com" }, StringLike = { "kms:EncryptionContext:aws:s3:arn" = local.backup_objects[1] } } },
    { Sid = "DenySourceWrites", Effect = "Deny", Action = ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"], Resource = local.source_objects }
  ] })
}
resource "aws_iam_role_policy" "recovery" {
  name = "waitron-${var.scope}-cold-recovery"
  role = reverse(split("/", var.recovery_role_arn))[0]
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Sid = "ReadRetainedSecrets", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = values(var.custody_refs.backup_secret_refs) },
    { Sid = "DecryptRetainedSecrets", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.custody_refs.backup_kms.secrets, Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${local.backup_region}.amazonaws.com", "kms:EncryptionContext:SecretARN" = values(var.custody_refs.backup_secret_refs) } } }
    ], flatten([for enabled in(var.scope == "es" ? [true] : []) : [
      { Sid = "ReadColdObjects", Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion"], Resource = local.backup_objects },
      { Sid = "ListColdVersions", Effect = "Allow", Action = ["s3:ListBucket", "s3:ListBucketVersions"], Resource = [for name in values(var.storage_refs.backup_buckets) : "arn:aws:s3:::${name}"], Condition = { StringLike = { "s3:prefix" = ["${var.prefixes.stream}*", "${var.prefixes.snapshot}*"] } } },
      { Sid = "DecryptColdSnapshots", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.custody_refs.backup_kms.storage, Condition = { StringEquals = { "kms:ViaService" = "s3.${local.backup_region}.amazonaws.com" }, StringLike = { "kms:EncryptionContext:aws:s3:arn" = local.backup_objects[1] } } }
  ]])) })
}
