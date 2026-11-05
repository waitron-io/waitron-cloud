data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
locals {
  account        = data.aws_caller_identity.current.account_id
  region         = data.aws_region.current.region
  primary_region = lookup({ global = "eu-central-1", es = "eu-south-2" }, var.scope, "")
  backup_region  = lookup({ global = "eu-west-1", es = "eu-west-3" }, var.scope, "")
  trail_arn      = "arn:aws:cloudtrail:${local.region}:${local.account}:trail/waitron-${var.scope}-audit"
  budget_arn     = "arn:aws:budgets::${local.account}:budget/waitron-${var.scope}-monthly"
  log_names = merge({ rds = "/aws/rds/instance/${var.resources.database_identifier}/postgresql", vpc = "/waitron/${var.scope}/vpc-flow" },
    { for name in var.resources.cell_names : "eks/${name}" => "/aws/eks/${name}/cluster" },
  { for name in var.resources.cell_names : "metrics/${name}" => "/aws/containerinsights/${name}/performance" })
  alarms = merge({
    database-storage     = { namespace = "AWS/RDS", metric = "FreeStorageSpace", statistic = "Minimum", operator = "LessThanThreshold", threshold = 1073741824, dimensions = { DBInstanceIdentifier = var.resources.database_identifier } },
    database-connections = { namespace = "AWS/RDS", metric = "DatabaseConnections", statistic = "Maximum", operator = "GreaterThanOrEqualToThreshold", threshold = 80, dimensions = { DBInstanceIdentifier = var.resources.database_identifier } }
    }, { for name in var.resources.cell_names : "nodes-${name}" => { namespace = "ContainerInsights", metric = "cluster_failed_node_count", statistic = "Maximum", operator = "GreaterThanOrEqualToThreshold", threshold = 1, dimensions = { ClusterName = name } } },
  { for kind, rule in var.resources.replication : "replication-${kind}" => { namespace = "AWS/S3", metric = "OperationsFailedReplication", statistic = "Sum", operator = "GreaterThanOrEqualToThreshold", threshold = 1, dimensions = { SourceBucket = rule.source_bucket, DestinationBucket = rule.destination_bucket, RuleId = rule.rule_id } } })
  alarm_arns = [for name in sort(keys(local.alarms)) : "arn:aws:cloudwatch:${local.region}:${local.account}:alarm:waitron-${var.scope}-${name}"]
}
resource "aws_cloudwatch_log_group" "operational" {
  for_each          = local.log_names
  name              = each.value
  kms_key_id        = var.kms_key_arn
  retention_in_days = var.retention.operational_days
}
resource "aws_s3_bucket" "audit" {
  bucket        = "waitron-${var.scope}-audit-${local.account}-${local.region}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_ownership_controls" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "audit" {
  bucket     = aws_s3_bucket.audit.id
  depends_on = [aws_s3_bucket_versioning.audit]
  rule {
    id     = "retention"
    status = "Enabled"
    filter {}
    expiration { days = var.retention.audit_days }
    noncurrent_version_expiration { noncurrent_days = var.retention.audit_days }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}
resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "TrailAcl", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = "s3:GetBucketAcl", Resource = aws_s3_bucket.audit.arn, Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn } } },
    { Sid = "TrailAppend", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = "s3:PutObject", Resource = "${aws_s3_bucket.audit.arn}/AWSLogs/${local.account}/*", Condition = { StringEquals = { "aws:SourceArn" = local.trail_arn, "s3:x-amz-acl" = "bucket-owner-full-control" } } },
    { Sid = "DenyInsecure", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } },
    { Sid = "DenyForeignAccount", Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"], Condition = { StringNotEquals = { "aws:PrincipalAccount" = local.account }, Bool = { "aws:PrincipalIsAWSService" = "false" } } }
  ] })
}
resource "aws_cloudtrail" "regional" {
  name                          = "waitron-${var.scope}-audit"
  s3_bucket_name                = aws_s3_bucket.audit.bucket
  kms_key_id                    = var.kms_key_arn
  enable_logging                = true
  enable_log_file_validation    = true
  is_multi_region_trail         = false
  is_organization_trail         = false
  include_global_service_events = true
  event_selector {
    include_management_events = true
    read_write_type           = "All"
  }
  depends_on = [aws_s3_bucket_policy.audit, aws_s3_bucket_public_access_block.audit, aws_s3_bucket_ownership_controls.audit, aws_s3_bucket_versioning.audit, aws_s3_bucket_server_side_encryption_configuration.audit, aws_s3_bucket_lifecycle_configuration.audit]
}
resource "aws_iam_role" "flow" {
  name = "waitron-${var.scope}-flow-logs"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "vpc-flow-logs.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = local.account }, ArnLike = { "aws:SourceArn" = "arn:aws:ec2:${local.region}:${local.account}:vpc-flow-log/*" } }
  }] })
}
resource "aws_iam_role_policy" "flow" {
  role = aws_iam_role.flow.name
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = "${aws_cloudwatch_log_group.operational["vpc"].arn}:*" },
    { Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = local.region } } }
  ] })
}
resource "aws_flow_log" "vpc" {
  vpc_id                   = var.resources.vpc_id
  traffic_type             = "ALL"
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.operational["vpc"].arn
  iam_role_arn             = aws_iam_role.flow.arn
  max_aggregation_interval = 60
  log_format               = "$${version} $${account-id} $${interface-id} $${srcaddr} $${dstaddr} $${srcport} $${dstport} $${protocol} $${packets} $${bytes} $${start} $${end} $${action} $${log-status}"
  depends_on               = [aws_iam_role_policy.flow]
}
resource "aws_sns_topic" "operator" {
  name              = "waitron-${var.scope}-operator"
  kms_master_key_id = var.kms_key_arn
}
resource "aws_sns_topic_policy" "operator" {
  arn = aws_sns_topic.operator.arn
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "Budget", Effect = "Allow", Principal = { Service = "budgets.amazonaws.com" }, Action = "sns:Publish", Resource = aws_sns_topic.operator.arn, Condition = { StringEquals = { "aws:SourceAccount" = local.account }, ArnEquals = { "aws:SourceArn" = local.budget_arn } } },
    { Sid = "Alarms", Effect = "Allow", Principal = { Service = "cloudwatch.amazonaws.com" }, Action = "sns:Publish", Resource = aws_sns_topic.operator.arn, Condition = { StringEquals = { "aws:SourceAccount" = local.account }, ArnEquals = { "aws:SourceArn" = local.alarm_arns } } },
    { Sid = "DenyInsecure", Effect = "Deny", Principal = "*", Action = "sns:*", Resource = aws_sns_topic.operator.arn, Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_budgets_budget" "monthly" {
  name         = "waitron-${var.scope}-monthly"
  account_id   = local.account
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  dynamic "notification" {
    for_each = toset(["ACTUAL", "FORECASTED"])
    content {
      notification_type          = notification.value
      threshold                  = 100
      threshold_type             = "PERCENTAGE"
      comparison_operator        = "GREATER_THAN"
      subscriber_sns_topic_arns  = [aws_sns_topic.operator.arn]
      subscriber_email_addresses = []
    }
  }
  depends_on = [aws_sns_topic_policy.operator]
}
resource "aws_cloudwatch_metric_alarm" "infrastructure" {
  for_each                  = local.alarms
  alarm_name                = "waitron-${var.scope}-${each.key}"
  namespace                 = each.value.namespace
  metric_name               = each.value.metric
  comparison_operator       = each.value.operator
  evaluation_periods        = 2
  period                    = 60
  statistic                 = each.value.statistic
  threshold                 = each.value.threshold
  dimensions                = each.value.dimensions
  treat_missing_data        = "missing"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.operator.arn]
  ok_actions                = []
  insufficient_data_actions = []
  depends_on                = [aws_sns_topic_policy.operator]
}
