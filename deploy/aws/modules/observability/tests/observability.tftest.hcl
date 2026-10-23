mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "333333333333"
    }
  }
  mock_data "aws_region" {
    defaults = {
      region = "eu-south-2"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:eu-south-2:333333333333:log-group:synthetic"
    }
  }
  mock_resource "aws_sns_topic" {
    defaults = {
      arn = "arn:aws:sns:eu-south-2:333333333333:waitron-es-operator"
    }
  }
  mock_resource "aws_s3_bucket" {
    defaults = {
      id = "waitron-es-audit-333333333333-eu-south-2", arn = "arn:aws:s3:::waitron-es-audit-333333333333-eu-south-2"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::333333333333:role/waitron-es-flow-logs"
    }
  }
}
mock_provider "aws" {
  alias = "backup"
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "333333333333"
    }
  }
  mock_data "aws_region" {
    defaults = {
      region = "eu-west-3"
    }
  }
}
variables {
  scope       = "es"
  kms_key_arn = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111"
  resources = {
    vpc_id = "vpc-00000000000000001", database_identifier = "waitron-es", cell_names = ["waitron-es-01"], replication = {
      stream = {
        source_bucket = "waitron-es-stream-333333333333-eu-south-2", destination_bucket = "waitron-es-stream-333333333333-eu-west-3", rule_id = "cold"
      },
      snapshot = {
        source_bucket = "waitron-es-snapshot-333333333333-eu-south-2", destination_bucket = "waitron-es-snapshot-333333333333-eu-west-3", rule_id = "cold"
      }
    }
  }
  budget_limit_usd = 123.45
}
run "local_logs_only" {
  command = plan
  assert {
    condition = try({
      for k, v in aws_cloudwatch_log_group.operational : k => v.name
      }
      == {
        rds = "/aws/rds/instance/waitron-es/postgresql", vpc = "/waitron/es/vpc-flow", "eks/waitron-es-01" = "/aws/eks/waitron-es-01/cluster", "metrics/waitron-es-01" = "/aws/containerinsights/waitron-es-01/performance"
      },
    false)
    error_message = "Declare only primary EKS, performance, PostgreSQL and VPC metadata destinations"
  }
  assert {
    condition     = try(alltrue([for g in aws_cloudwatch_log_group.operational : g.kms_key_id == var.kms_key_arn]), false)
    error_message = "Encrypt every operational destination with this scope primary log key"
  }
  assert {
    condition     = try(aws_flow_log.vpc.vpc_id == var.resources.vpc_id && aws_flow_log.vpc.log_destination == aws_cloudwatch_log_group.operational["vpc"].arn && aws_flow_log.vpc.iam_role_arn == aws_iam_role.flow.arn && aws_flow_log.vpc.traffic_type == "ALL" && aws_flow_log.vpc.log_destination_type == "cloud-watch-logs" && aws_flow_log.vpc.max_aggregation_interval == 60, false)
    error_message = "Bind actual VPC metadata flow delivery to its own group and role"
  }
}
run "finite_log_retention" {
  command = plan
  assert {
    condition     = try(alltrue([for g in aws_cloudwatch_log_group.operational : g.retention_in_days == 30]) && aws_s3_bucket_lifecycle_configuration.audit.rule[0].expiration[0].days == 90 && aws_s3_bucket_lifecycle_configuration.audit.rule[0].noncurrent_version_expiration[0].noncurrent_days == 90 && aws_s3_bucket_lifecycle_configuration.audit.rule[0].status == "Enabled", false)
    error_message = "Operational logs expire after 30 days and current and previous audit versions after 90"
  }
  assert {
    condition     = try(aws_s3_bucket_versioning.audit.versioning_configuration[0].status == "Enabled" && aws_s3_bucket_ownership_controls.audit.rule[0].object_ownership == "BucketOwnerEnforced" && aws_s3_bucket_lifecycle_configuration.audit.bucket == aws_s3_bucket.audit.id, false)
    error_message = "Retain audit history with bucket owner enforcement and finite lifecycle"
  }
}
run "encrypted_audit_trail" {
  command = plan
  assert {
    condition     = try(aws_cloudtrail.regional.enable_logging && aws_cloudtrail.regional.enable_log_file_validation && !aws_cloudtrail.regional.is_multi_region_trail && !aws_cloudtrail.regional.is_organization_trail && aws_cloudtrail.regional.kms_key_id == var.kms_key_arn && aws_cloudtrail.regional.s3_bucket_name == aws_s3_bucket.audit.bucket && aws_cloudtrail.regional.name == "waitron-es-audit", false)
    error_message = "Keep a logging regional validated trail using its explicit audit store and log key"
  }
  assert {
    condition     = try(aws_cloudtrail.regional.event_selector[0].include_management_events && aws_cloudtrail.regional.event_selector[0].read_write_type == "All" && length(aws_cloudtrail.regional.event_selector[0].data_resource) == 0, false)
    error_message = "Audit infrastructure management events without customer object data-event selectors"
  }
  assert {
    condition     = try(one(aws_s3_bucket_server_side_encryption_configuration.audit.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "aws:kms" && one(aws_s3_bucket_server_side_encryption_configuration.audit.rule).apply_server_side_encryption_by_default[0].kms_master_key_id == var.kms_key_arn && aws_s3_bucket_public_access_block.audit.block_public_acls && aws_s3_bucket_public_access_block.audit.block_public_policy && aws_s3_bucket_public_access_block.audit.ignore_public_acls && aws_s3_bucket_public_access_block.audit.restrict_public_buckets, false)
    error_message = "Audit objects require regional key encryption and every public access block"
  }
}
run "audit_delivery_source_permissions" {
  command = plan
  assert {
    condition = try(jsondecode(aws_s3_bucket_policy.audit.policy).Statement[0] == {
      Sid = "TrailAcl", Effect = "Allow", Principal = {
        Service = "cloudtrail.amazonaws.com"
      },
      Action = "s3:GetBucketAcl", Resource = "arn:aws:s3:::waitron-es-audit-333333333333-eu-south-2", Condition = {
        StringEquals = {
          "aws:SourceArn" = "arn:aws:cloudtrail:eu-south-2:333333333333:trail/waitron-es-audit"
        }
      }
      },
    false)
    error_message = "Audit ACL reads require the exact regional trail"
  }
  assert {
    condition = try(jsondecode(aws_s3_bucket_policy.audit.policy).Statement[1].Effect == "Allow" && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[1].Resource == "arn:aws:s3:::waitron-es-audit-333333333333-eu-south-2/AWSLogs/333333333333/*" && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[1].Action == "s3:PutObject" && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[1].Condition.StringEquals == {
      "aws:SourceArn" = "arn:aws:cloudtrail:eu-south-2:333333333333:trail/waitron-es-audit", "s3:x-amz-acl" = "bucket-owner-full-control"
      }
    && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[1].Principal.Service == "cloudtrail.amazonaws.com", false)
    error_message = "Only the regional trail can append account-bound audit paths"
  }
  assert {
    condition = try(jsondecode(aws_s3_bucket_policy.audit.policy).Statement[2].Effect == "Deny" && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[2].Condition.Bool == {
      "aws:SecureTransport" = "false"
      }
      && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[3].Effect == "Deny" && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[3].Condition.StringNotEquals == {
        "aws:PrincipalAccount" = "333333333333"
      }
      && jsondecode(aws_s3_bucket_policy.audit.policy).Statement[3].Condition.Bool == {
        "aws:PrincipalIsAWSService" = "false"
      },
    false)
    error_message = "Deny insecure and foreign-account access without denying scoped AWS service delivery"
  }
}
run "flow_delivery_permissions" {
  command = plan
  assert {
    condition = try(jsondecode(aws_iam_role.flow.assume_role_policy).Statement == [{
      Effect = "Allow", Principal = {
        Service = "vpc-flow-logs.amazonaws.com"
      },
      Action = "sts:AssumeRole", Condition = {
        StringEquals = {
          "aws:SourceAccount" = "333333333333"
        },
        ArnLike = {
          "aws:SourceArn" = "arn:aws:ec2:eu-south-2:333333333333:vpc-flow-log/*"
        }
      }
      }
    ], false)
    error_message = "Flow role trust is bound to regional flow-log service sources in this account"
  }
  assert {
    condition = try(length(jsondecode(aws_iam_role_policy.flow.policy).Statement) == 2 && jsondecode(aws_iam_role_policy.flow.policy).Statement[0].Effect == "Allow" && jsondecode(aws_iam_role_policy.flow.policy).Statement[1].Effect == "Allow" && jsondecode(aws_iam_role_policy.flow.policy).Statement[0].Action == ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"] && jsondecode(aws_iam_role_policy.flow.policy).Statement[0].Resource == "${aws_cloudwatch_log_group.operational["vpc"].arn}:*" && jsondecode(aws_iam_role_policy.flow.policy).Statement[1].Action == ["logs:DescribeLogGroups"] && jsondecode(aws_iam_role_policy.flow.policy).Statement[1].Condition.StringEquals == {
      "aws:RequestedRegion" = "eu-south-2"
      },
    false)
    error_message = "Flow delivery can write only its own precreated regional metadata log streams"
  }
}
run "budget_has_no_customer_destination" {
  command = plan
  assert {
    condition     = try(aws_sns_topic.operator.kms_master_key_id == var.kms_key_arn && aws_sns_topic.operator.name == "waitron-es-operator" && aws_budgets_budget.monthly.name == "waitron-es-monthly" && aws_budgets_budget.monthly.account_id == "333333333333" && aws_budgets_budget.monthly.limit_amount == "123.45" && aws_budgets_budget.monthly.limit_unit == "USD" && aws_budgets_budget.monthly.time_unit == "MONTHLY" && aws_budgets_budget.monthly.budget_type == "COST", false)
    error_message = "External dollar threshold and encrypted operator topic bind to this account"
  }
  assert {
    condition     = try(toset([for n in aws_budgets_budget.monthly.notification : n.notification_type]) == toset(["ACTUAL", "FORECASTED"]) && length(aws_budgets_budget.monthly.notification) == 2 && alltrue([for n in aws_budgets_budget.monthly.notification : n.threshold == 100 && n.threshold_type == "PERCENTAGE" && n.comparison_operator == "GREATER_THAN" && n.subscriber_sns_topic_arns == toset([aws_sns_topic.operator.arn]) && length(n.subscriber_email_addresses) == 0]), false)
    error_message = "Both actual and forecasted thresholds notify only the operator topic without mail"
  }
}
run "budget_source_permissions" {
  command = plan
  assert {
    condition = try(jsondecode(aws_sns_topic_policy.operator.policy).Statement[0] == {
      Sid = "Budget", Effect = "Allow", Principal = {
        Service = "budgets.amazonaws.com"
      },
      Action = "sns:Publish", Resource = aws_sns_topic.operator.arn, Condition = {
        StringEquals = {
          "aws:SourceAccount" = "333333333333"
        },
        ArnEquals = {
          "aws:SourceArn" = "arn:aws:budgets::333333333333:budget/waitron-es-monthly"
        }
      }
      },
    false)
    error_message = "Budget publishing requires its exact service account and budget ARN"
  }
  assert {
    condition = try(jsondecode(aws_sns_topic_policy.operator.policy).Statement[1].Effect == "Allow" && jsondecode(aws_sns_topic_policy.operator.policy).Statement[1].Action == "sns:Publish" && jsondecode(aws_sns_topic_policy.operator.policy).Statement[1].Resource == aws_sns_topic.operator.arn && jsondecode(aws_sns_topic_policy.operator.policy).Statement[1].Principal.Service == "cloudwatch.amazonaws.com" && jsondecode(aws_sns_topic_policy.operator.policy).Statement[1].Condition.StringEquals == {
      "aws:SourceAccount" = "333333333333"
      }
    && toset(jsondecode(aws_sns_topic_policy.operator.policy).Statement[1].Condition.ArnEquals["aws:SourceArn"]) == toset([for a in aws_cloudwatch_metric_alarm.infrastructure : "arn:aws:cloudwatch:eu-south-2:333333333333:alarm:${a.alarm_name}"]), false)
    error_message = "Only the named regional alarms may publish to the operator topic"
  }
  assert {
    condition = try(length(jsondecode(aws_sns_topic_policy.operator.policy).Statement) == 3 && jsondecode(aws_sns_topic_policy.operator.policy).Statement[2].Effect == "Deny" && jsondecode(aws_sns_topic_policy.operator.policy).Statement[2].Condition.Bool == {
      "aws:SecureTransport" = "false"
      },
    false)
    error_message = "Refuse insecure topic delivery with no extra publish permissions"
  }
}
run "regional_alarm_metrics" {
  command = plan
  assert {
    condition = try(aws_cloudwatch_metric_alarm.infrastructure["database-storage"].namespace == "AWS/RDS" && aws_cloudwatch_metric_alarm.infrastructure["database-storage"].metric_name == "FreeStorageSpace" && aws_cloudwatch_metric_alarm.infrastructure["database-storage"].comparison_operator == "LessThanThreshold" && aws_cloudwatch_metric_alarm.infrastructure["database-storage"].threshold == 1073741824 && aws_cloudwatch_metric_alarm.infrastructure["database-storage"].statistic == "Minimum" && aws_cloudwatch_metric_alarm.infrastructure["database-storage"].dimensions == tomap({
      DBInstanceIdentifier = "waitron-es"
      })
    && aws_cloudwatch_metric_alarm.infrastructure["database-connections"].metric_name == "DatabaseConnections" && aws_cloudwatch_metric_alarm.infrastructure["database-connections"].threshold == 80, false)
    error_message = "Database alarms observe actual regional free storage and connection counts"
  }
  assert {
    condition = try(aws_cloudwatch_metric_alarm.infrastructure["nodes-waitron-es-01"].namespace == "ContainerInsights" && aws_cloudwatch_metric_alarm.infrastructure["nodes-waitron-es-01"].metric_name == "cluster_failed_node_count" && aws_cloudwatch_metric_alarm.infrastructure["nodes-waitron-es-01"].dimensions == tomap({
      ClusterName = "waitron-es-01"
      })
    && aws_cloudwatch_metric_alarm.infrastructure["nodes-waitron-es-01"].threshold == 1, false)
    error_message = "Node health alarm consumes the explicit Container Insights metric for this cell"
  }
  assert {
    condition = try(alltrue([for k in ["stream", "snapshot"] : aws_cloudwatch_metric_alarm.infrastructure["replication-${k}"].namespace == "AWS/S3" && aws_cloudwatch_metric_alarm.infrastructure["replication-${k}"].metric_name == "OperationsFailedReplication" && aws_cloudwatch_metric_alarm.infrastructure["replication-${k}"].dimensions == tomap({
      SourceBucket = "waitron-es-${k}-333333333333-eu-south-2", DestinationBucket = "waitron-es-${k}-333333333333-eu-west-3", RuleId = "cold"
      })
    && aws_cloudwatch_metric_alarm.infrastructure["replication-${k}"].statistic == "Sum"]), false)
    error_message = "Replication failure alarms use source-region metrics and the exact source destination and rule"
  }
  assert {
    condition     = try(length(aws_cloudwatch_metric_alarm.infrastructure) == 5 && alltrue([for k, a in aws_cloudwatch_metric_alarm.infrastructure : a.alarm_name == "waitron-es-${k}" && a.actions_enabled && toset(a.alarm_actions) == toset([aws_sns_topic.operator.arn]) && length(a.ok_actions) == 0 && length(a.insufficient_data_actions) == 0 && a.treat_missing_data == "missing" && a.period == 60 && a.evaluation_periods == 2]), false)
    error_message = "Only the five named alarms emit operator signals and missing metrics remain unknown"
  }
}
run "reference_only_handoff" {
  command = plan
  assert {
    condition = try(output.observability == {
      logs = {
        for k, g in aws_cloudwatch_log_group.operational : k => g.arn
      },
      signals = merge({
        operator = aws_sns_topic.operator.arn
        },
        {
          for k, a in aws_cloudwatch_metric_alarm.infrastructure : k => a.arn
        }
      ), budget_ref = aws_budgets_budget.monthly.arn
      },
    false)
    error_message = "The handoff contains only the declared regional evidence and operator signal references"
  }
}
run "rejects_unbounded_retention" {
  command = plan
  variables {
    retention = {
      operational_days = 0, audit_days = 90
    }
  }
  expect_failures = [var.retention]
}
run "rejects_negative_audit" {
  command = plan
  variables {
    retention = {
      operational_days = 30, audit_days = -1
    }
  }
  expect_failures = [var.retention]
}
run "rejects_excessive_retention" {
  command = plan
  variables {
    retention = {
      operational_days = 400, audit_days = 90
    }
  }
  expect_failures = [var.retention]
}
run "rejects_fractional_retention" {
  command = plan
  variables {
    retention = {
      operational_days = 30, audit_days = 30.5
    }
  }
  expect_failures = [var.retention]
}
run "rejects_zero_budget" {
  command = plan
  variables {
    budget_limit_usd = 0
  }
  expect_failures = [var.budget_limit_usd]
}
run "rejects_negative_budget" {
  command = plan
  variables {
    budget_limit_usd = -1
  }
  expect_failures = [var.budget_limit_usd]
}
run "rejects_unknown_scope" {
  command = plan
  variables {
    scope = "fr"
  }
  expect_failures = [var.scope]
}
run "rejects_wrong_key_region" {
  command = plan
  variables {
    kms_key_arn = "arn:aws:kms:eu-west-3:333333333333:key/11111111-1111-1111-1111-111111111111"
  }
  expect_failures = [output.observability]
}
run "rejects_foreign_key" {
  command = plan
  variables {
    kms_key_arn = "arn:aws:kms:eu-south-2:222222222222:key/11111111-1111-1111-1111-111111111111"
  }
  expect_failures = [output.observability]
}
run "rejects_key_wildcard" {
  command = plan
  variables {
    kms_key_arn = "arn:aws:kms:eu-south-2:333333333333:key/*"
  }
  expect_failures = [var.kms_key_arn]
}
run "rejects_foreign_cell" {
  command = plan
  variables {
    resources = {
      vpc_id = "vpc-00000000000000001", database_identifier = "waitron-es", cell_names = ["waitron-global-01"], replication = { stream = { source_bucket = "waitron-es-stream-333333333333-eu-south-2", destination_bucket = "waitron-es-stream-333333333333-eu-west-3", rule_id = "cold" }, snapshot = { source_bucket = "waitron-es-snapshot-333333333333-eu-south-2", destination_bucket = "waitron-es-snapshot-333333333333-eu-west-3", rule_id = "cold" } }
    }
  }
  expect_failures = [var.resources]
}
run "rejects_foreign_database" {
  command = plan
  variables {
    resources = {
      vpc_id = "vpc-00000000000000001", database_identifier = "waitron-global", cell_names = ["waitron-es-01"], replication = { stream = { source_bucket = "waitron-es-stream-333333333333-eu-south-2", destination_bucket = "waitron-es-stream-333333333333-eu-west-3", rule_id = "cold" }, snapshot = { source_bucket = "waitron-es-snapshot-333333333333-eu-south-2", destination_bucket = "waitron-es-snapshot-333333333333-eu-west-3", rule_id = "cold" } }
    }
  }
  expect_failures = [var.resources]
}
run "rejects_unbound_replication" {
  command = plan
  variables {
    resources = {
      vpc_id = "vpc-00000000000000001", database_identifier = "waitron-es", cell_names = ["waitron-es-01"], replication = {
        stream = {
          source_bucket = "foreign", destination_bucket = "foreign", rule_id = "cold"
        },
        snapshot = {
          source_bucket = "foreign", destination_bucket = "foreign", rule_id = "cold"
        }
      }
    }
  }
  expect_failures = [output.observability]
}
run "rejects_wrong_provider_region" {
  command = plan
  override_data {
    target = data.aws_region.current
    values = {
      region = "eu-west-3"
    }
  }
  expect_failures = [output.observability]
}
run "global_omits_venue_replication" {
  command = plan
  override_resource {
    target = aws_sns_topic.operator
    values = { arn = "arn:aws:sns:eu-central-1:222222222222:waitron-global-operator" }
  }
  override_resource {
    target = aws_s3_bucket.audit
    values = { id = "waitron-global-audit-222222222222-eu-central-1", arn = "arn:aws:s3:::waitron-global-audit-222222222222-eu-central-1" }
  }
  override_resource {
    target = aws_iam_role.flow
    values = { arn = "arn:aws:iam::222222222222:role/waitron-global-flow-logs" }
  }
  variables {
    scope       = "global"
    kms_key_arn = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111"
    resources = {
      vpc_id = "vpc-00000000000000002", database_identifier = "waitron-global", cell_names = ["waitron-global-01"], replication = {
      }
    }
  }
  override_data {
    target = data.aws_region.current
    values = {
      region = "eu-central-1"
    }
  }
  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "222222222222"
    }
  }
  assert {
    condition     = try(length(aws_cloudwatch_metric_alarm.infrastructure) == 3 && length(aws_cloudwatch_log_group.operational) == 4 && aws_cloudwatch_log_group.operational["rds"].name == "/aws/rds/instance/waitron-global/postgresql" && aws_cloudwatch_log_group.operational["eks/waitron-global-01"].name == "/aws/eks/waitron-global-01/cluster" && aws_s3_bucket.audit.bucket == "waitron-global-audit-222222222222-eu-central-1" && aws_cloudtrail.regional.kms_key_id == var.kms_key_arn, false)
    error_message = "Global evidence and signals belong to its independent Frankfurt account without country replication"
  }
}
run "scoped_log_key_service_permissions" {
  command = plan
  module { source = "../custody" }
  providers = { aws = aws, aws.backup = aws.backup, aws.keys = aws.keys, aws.backup_keys = aws.backup_keys }
  variables {
    scope               = "es"
    region_pair         = { primary = "eu-south-2", backup = "eu-west-3" }
    authorities         = { deployment = "arn:aws:iam::333333333333:role/waitron-es-deployment", key_administration = "arn:aws:iam::333333333333:role/waitron-es-key-administration", recovery = "arn:aws:iam::333333333333:role/waitron-es-recovery" }
    observability_cells = ["waitron-es-01"]
  }
  assert {
    condition     = try(jsondecode(aws_kms_key.primary["logs"].policy).Statement[2] == { Sid = "RegionalLogs", Effect = "Allow", Principal = { Service = "logs.eu-south-2.amazonaws.com" }, Action = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"], Resource = "*", Condition = { ArnEquals = { "kms:EncryptionContext:aws:logs:arn" = ["arn:aws:logs:eu-south-2:333333333333:log-group:/aws/containerinsights/waitron-es-01/performance", "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/eks/waitron-es-01/cluster", "arn:aws:logs:eu-south-2:333333333333:log-group:/aws/rds/instance/waitron-es/postgresql", "arn:aws:logs:eu-south-2:333333333333:log-group:/waitron/es/vpc-flow"] } } }, false)
    error_message = "Only named regional log-group encryption contexts may use the log key"
  }
  assert {
    condition     = try(jsondecode(aws_kms_key.primary["logs"].policy).Statement[3] == { Sid = "TrailEncryption", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = ["kms:GenerateDataKey*"], Resource = "*", Condition = { StringEquals = { "aws:SourceArn" = "arn:aws:cloudtrail:eu-south-2:333333333333:trail/waitron-es-audit", "kms:EncryptionContext:aws:cloudtrail:arn" = "arn:aws:cloudtrail:eu-south-2:333333333333:trail/waitron-es-audit" } } } && jsondecode(aws_kms_key.primary["logs"].policy).Statement[4] == { Sid = "TrailDescribe", Effect = "Allow", Principal = { Service = "cloudtrail.amazonaws.com" }, Action = ["kms:DescribeKey"], Resource = "*", Condition = { StringEquals = { "aws:SourceArn" = "arn:aws:cloudtrail:eu-south-2:333333333333:trail/waitron-es-audit" } } }, false)
    error_message = "Trail key generation and describe permissions require this exact regional trail"
  }
  assert {
    condition     = try(jsondecode(aws_kms_key.primary["logs"].policy).Statement[5] == { Sid = "BudgetSignals", Effect = "Allow", Principal = { Service = "budgets.amazonaws.com" }, Action = ["kms:GenerateDataKey*", "kms:Decrypt"], Resource = "*", Condition = { StringEquals = { "aws:SourceAccount" = "333333333333" }, ArnEquals = { "aws:SourceArn" = "arn:aws:budgets::333333333333:budget/waitron-es-monthly" } } }, false)
    error_message = "Budget service key delivery requires this account and exact budget ARN"
  }
  assert {
    condition     = try(jsondecode(aws_kms_key.primary["logs"].policy).Statement[6] == { Sid = "AlarmSignals", Effect = "Allow", Principal = { Service = "cloudwatch.amazonaws.com" }, Action = ["kms:GenerateDataKey*", "kms:Decrypt"], Resource = "*", Condition = { StringEquals = { "aws:SourceAccount" = "333333333333" }, ArnEquals = { "aws:SourceArn" = ["arn:aws:cloudwatch:eu-south-2:333333333333:alarm:waitron-es-database-connections", "arn:aws:cloudwatch:eu-south-2:333333333333:alarm:waitron-es-database-storage", "arn:aws:cloudwatch:eu-south-2:333333333333:alarm:waitron-es-nodes-waitron-es-01", "arn:aws:cloudwatch:eu-south-2:333333333333:alarm:waitron-es-replication-snapshot", "arn:aws:cloudwatch:eu-south-2:333333333333:alarm:waitron-es-replication-stream"] } } }, false)
    error_message = "Alarm key delivery requires only the named regional infrastructure alarms"
  }
  assert {
    condition     = alltrue([for k, v in aws_kms_key.primary : k == "logs" || length(jsondecode(v.policy).Statement) == 2]) && alltrue([for v in aws_kms_key.backup : length(jsondecode(v.policy).Statement) == 2])
    error_message = "Operational services gain no permissions on other key purposes or cold keys"
  }
}
run "rejects_foreign_custody_cell" {
  command = plan
  module { source = "../custody" }
  providers = { aws = aws, aws.backup = aws.backup, aws.keys = aws.keys, aws.backup_keys = aws.backup_keys }
  variables {
    scope               = "es"
    region_pair         = { primary = "eu-south-2", backup = "eu-west-3" }
    authorities         = { deployment = "arn:aws:iam::333333333333:role/waitron-es-deployment", key_administration = "arn:aws:iam::333333333333:role/waitron-es-key-administration", recovery = "arn:aws:iam::333333333333:role/waitron-es-recovery" }
    observability_cells = ["waitron-global-01"]
  }
  expect_failures = [var.observability_cells]
}
run "external_budget_threshold" {
  command = plan
  variables { budget_limit_usd = 987.65 }
  assert {
    condition     = aws_budgets_budget.monthly.limit_amount == "987.65"
    error_message = "The declared monthly threshold must follow the supplied positive input"
  }
}

mock_provider "aws" {
  alias = "keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444" } }
}
mock_provider "aws" {
  alias = "backup_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" } }
}
