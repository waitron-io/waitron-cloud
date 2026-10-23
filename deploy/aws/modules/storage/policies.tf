resource "aws_s3_bucket_policy" "primary" {
  for_each = local.kinds
  bucket   = aws_s3_bucket.primary[each.key].bucket
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = ["arn:aws:s3:::${aws_s3_bucket.primary[each.key].bucket}", "arn:aws:s3:::${aws_s3_bucket.primary[each.key].bucket}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
      { Sid = "DenyForeignPrincipals", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = ["arn:aws:s3:::${aws_s3_bucket.primary[each.key].bucket}", "arn:aws:s3:::${aws_s3_bucket.primary[each.key].bucket}/*"], Condition = { StringNotEquals = { "aws:PrincipalAccount" = data.aws_caller_identity.primary.account_id } } }
      ], each.key == "snapshot" ? [
      { Sid = "DenyWrongEncryption", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${aws_s3_bucket.primary[each.key].bucket}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" }, Null = { "s3:x-amz-server-side-encryption" = "false" } } },
      { Sid = "DenyWrongKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${aws_s3_bucket.primary[each.key].bucket}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = var.kms.primary }, Null = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = "false" } } },
      { Sid = "DenyCustomerKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${aws_s3_bucket.primary[each.key].bucket}/*", Condition = { Null = { "s3:x-amz-server-side-encryption-customer-algorithm" = "false" } } }
    ] : [])
  })
}
resource "aws_s3_bucket_policy" "backup" {
  provider = aws.backup
  for_each = local.kinds
  bucket   = aws_s3_bucket.backup[each.key].bucket
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      { Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = ["arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}", "arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
      { Sid = "DenyForeignPrincipals", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = ["arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}", "arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}/*"], Condition = { StringNotEquals = { "aws:PrincipalAccount" = data.aws_caller_identity.primary.account_id } } }
      ], each.key == "snapshot" ? [
      { Sid = "DenyWrongEncryption", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption" = "aws:kms" }, Null = { "s3:x-amz-server-side-encryption" = "false" } } },
      { Sid = "DenyWrongKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}/*", Condition = { StringNotEquals = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = var.kms.backup }, Null = { "s3:x-amz-server-side-encryption-aws-kms-key-id" = "false" } } },
      { Sid = "DenyCustomerKey", Effect = "Deny", Principal = "*", Action = "s3:PutObject", Resource = "arn:aws:s3:::${aws_s3_bucket.backup[each.key].bucket}/*", Condition = { Null = { "s3:x-amz-server-side-encryption-customer-algorithm" = "false" } } }
    ] : [])
  })
}
