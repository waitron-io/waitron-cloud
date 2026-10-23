mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  mock_resource "aws_secretsmanager_secret" { defaults = { arn = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/synthetic-ABCDEF" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" } }
  mock_resource "aws_db_instance" { defaults = { arn = "arn:aws:rds:eu-south-2:333333333333:db:waitron-es", address = "waitron-es.synthetic.invalid", master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_id = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", secret_status = "active" }] } }
}
mock_provider "aws" {
  alias = "backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
  mock_resource "aws_kms_key" { defaults = { arn = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" } }
}
run "composed_custody_references" {
  command = plan
  assert {
    condition     = module.storage.storage.kms_key_refs.primary == module.custody.kms.storage && module.storage.storage.kms_key_refs.backup == module.custody.backup_kms.storage && module.database.database.kms_key_ref == module.custody.kms.database
    error_message = "COMPOSED_CUSTODY_REFERENCES: storage and database must consume independent base key outputs"
  }
}
run "composed_workload_attachments" {
  command = plan
  assert {
    condition     = length(module.permissions.workload_roles) == 8 && toset(keys(module.permissions.attachment_refs)) == toset(["api", "registration-worker", "backup-worker", "backup-verifier", "remote-gateway", "remote-reconciler", "monitor-worker", "replication-storage", "recovery"])
    error_message = "COMPOSED_ATTACHMENTS: all agreed roles and the nine actual policies must consume the completed scope resources without a cycle"
  }
}
