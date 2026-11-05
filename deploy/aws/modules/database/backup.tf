resource "aws_db_instance_automated_backups_replication" "cold" {
  provider               = aws.backup
  source_db_instance_arn = aws_db_instance.management.arn
  kms_key_id             = var.kms.backup
  retention_period       = var.retention.backup
  lifecycle { prevent_destroy = true }
}
