output "observability" {
  value = { logs = { for k, g in aws_cloudwatch_log_group.operational : k => g.arn }, signals = merge({ operator = aws_sns_topic.operator.arn }, { for k, a in aws_cloudwatch_metric_alarm.infrastructure : k => a.arn }), budget_ref = aws_budgets_budget.monthly.arn }
  precondition {
    condition     = !contains(["global", "es"], var.scope) || local.region == local.primary_region
    error_message = "All operational evidence and signals must use the scope's primary region"
  }
  precondition {
    condition     = !contains(["global", "es"], var.scope) || startswith(var.kms_key_arn, "arn:aws:kms:${local.primary_region}:${local.account}:key/")
    error_message = "The log key must belong to this scope account and primary region"
  }
  precondition {
    condition     = alltrue([for kind, v in var.resources.replication : v.source_bucket == "waitron-${var.scope}-${kind}-${local.account}-${local.primary_region}" && v.destination_bucket == "waitron-${var.scope}-${kind}-${local.account}-${local.backup_region}"])
    error_message = "Every replication signal must bind the account's exact primary and cold stores"
  }
}
