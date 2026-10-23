mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  mock_resource "aws_security_group" { defaults = { id = "sg-00000000000000002" } }
  mock_resource "aws_db_instance" {
    defaults = {
      arn                = "arn:aws:rds:eu-south-2:333333333333:db:waitron-es"
      address            = "waitron-es.synthetic.invalid"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:synthetic-admin", kms_key_id = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", secret_status = "active" }]
    }
  }
}
mock_provider "aws" {
  alias = "backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
  mock_resource "aws_db_instance_automated_backups_replication" { defaults = { id = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" } }
}
variables {
  scope = "es"
  network = {
    vpc_id = "vpc-00000000000000001"
    database_subnet_ids = {
      eus2-az1 = "subnet-00000000000000001"
      eus2-az2 = "subnet-00000000000000002"
      eus2-az3 = "subnet-00000000000000003"
    }
    service_security_group_id = "sg-00000000000000001"
  }
  kms = {
    primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111"
    backup  = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222"
  }
  settings = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 }
}
run "multi_az_private_database" {
  command = plan
  assert {
    condition     = aws_db_instance.management.multi_az && !aws_db_instance.management.publicly_accessible && aws_db_instance.management.port == 5432 && aws_db_subnet_group.management.subnet_ids == toset(values(var.network.database_subnet_ids)) && aws_db_instance.management.db_subnet_group_name == aws_db_subnet_group.management.name && aws_security_group.database.vpc_id == var.network.vpc_id && aws_db_instance.management.vpc_security_group_ids == toset([aws_security_group.database.id])
    error_message = "The management database must span zones and use only its three private database subnets and database firewall"
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.postgres.security_group_id == aws_security_group.database.id && aws_vpc_security_group_ingress_rule.postgres.referenced_security_group_id == var.network.service_security_group_id && aws_vpc_security_group_ingress_rule.postgres.from_port == 5432 && aws_vpc_security_group_ingress_rule.postgres.to_port == 5432 && aws_vpc_security_group_ingress_rule.postgres.ip_protocol == "tcp" && aws_vpc_security_group_ingress_rule.postgres.cidr_ipv4 == null && aws_vpc_security_group_ingress_rule.postgres.cidr_ipv6 == null && aws_vpc_security_group_ingress_rule.postgres.prefix_list_id == null
    error_message = "Only this scope's service security group may connect on PostgreSQL TCP port 5432"
  }
}
run "encrypted_storage_and_tls" {
  command = plan
  assert {
    condition     = aws_db_instance.management.storage_encrypted && aws_db_instance.management.storage_type == "gp3" && aws_db_instance.management.kms_key_id == var.kms.primary && aws_db_instance.management.allocated_storage == 20 && aws_db_instance.management.max_allocated_storage == 100 && aws_db_instance.management.engine == "postgres" && aws_db_instance.management.engine_version == "17.6" && aws_db_instance.management.instance_class == "db.t3.small"
    error_message = "PostgreSQL must use its explicit version and class, encrypted gp3 storage and bounded autoscaling"
  }
  assert {
    condition     = aws_db_parameter_group.management.family == "postgres17" && aws_db_parameter_group.management.parameter == toset([{ name = "rds.force_ssl", value = "1", apply_method = "pending-reboot" }]) && aws_db_instance.management.parameter_group_name == aws_db_parameter_group.management.name
    error_message = "The database must use a matching PostgreSQL parameter group requiring TLS"
  }
}
run "managed_admin_and_deletion_protection" {
  command = plan
  assert {
    condition     = aws_db_instance.management.manage_master_user_password && aws_db_instance.management.password == null && aws_db_instance.management.master_user_secret_kms_key_id == var.kms.primary && aws_db_instance.management.username == "cloud_admin" && aws_db_instance.management.deletion_protection && !aws_db_instance.management.skip_final_snapshot && aws_db_instance.management.final_snapshot_identifier == "waitron-es-final" && !aws_db_instance.management.delete_automated_backups && aws_db_instance.management.copy_tags_to_snapshot
    error_message = "RDS must manage the encrypted admin secret and preserve database and backup deletion protections"
  }
}
run "encrypted_backup_destination" {
  command = plan
  assert {
    condition     = aws_db_instance.management.backup_retention_period == 7 && aws_db_instance_automated_backups_replication.cold.retention_period == 7 && aws_db_instance_automated_backups_replication.cold.kms_key_id == var.kms.backup && aws_db_instance_automated_backups_replication.cold.source_db_instance_arn == aws_db_instance.management.arn
    error_message = "Primary and cold regional automated backups must retain seven days and use the destination key and source database"
  }
}
run "database_handoff" {
  command = plan
  assert {
    condition     = output.database == { endpoint = aws_db_instance.management.address, port = 5432, name = "cloud_es", admin_secret_ref = aws_db_instance.management.master_user_secret[0].secret_arn, kms_key_ref = var.kms.primary, backup_ref = aws_db_instance_automated_backups_replication.cold.id } && output.database_backup_ref == aws_db_instance_automated_backups_replication.cold.id && aws_db_instance.management.identifier == "waitron-es" && aws_db_instance.management.db_name == "cloud_es"
    error_message = "The handoff must bind Spain's database and cold backup using references only"
  }
}
run "global_and_country_are_separate" {
  command = plan
  variables {
    scope   = "global"
    network = { vpc_id = "vpc-00000000000000002", database_subnet_ids = { euc1-az1 = "subnet-00000000000000011", euc1-az2 = "subnet-00000000000000012", euc1-az3 = "subnet-00000000000000013" }, service_security_group_id = "sg-00000000000000011" }
    kms     = { primary = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }
  }
  override_data {
    target = data.aws_region.primary
    values = { region = "eu-central-1" }
  }
  override_data {
    target = data.aws_region.backup
    values = { region = "eu-west-1" }
  }
  override_data {
    target = data.aws_caller_identity.primary
    values = { account_id = "222222222222" }
  }
  override_data {
    target = data.aws_caller_identity.backup
    values = { account_id = "222222222222" }
  }
  override_data {
    target = data.aws_availability_zones.primary
    values = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }
  }
  assert {
    condition     = aws_db_instance.management.identifier == "waitron-global" && aws_db_instance.management.db_name == "cloud_global" && output.database.name == "cloud_global" && aws_db_instance.management.kms_key_id == var.kms.primary && aws_db_instance_automated_backups_replication.cold.kms_key_id == var.kms.backup && aws_vpc_security_group_ingress_rule.postgres.referenced_security_group_id == "sg-00000000000000011"
    error_message = "Global must use an independent database, key pair, network and service firewall"
  }
}
run "rejects_zero_retention" {
  command = plan
  variables { retention = { primary = 0, backup = 7 } }
  expect_failures = [var.retention]
}
run "rejects_zero_destination_retention" {
  command = plan
  variables { retention = { primary = 7, backup = 0 } }
  expect_failures = [var.retention]
}
run "rejects_wrong_backup_region" {
  command = plan
  override_data {
    target = data.aws_region.backup
    values = { region = "eu-west-1" }
  }
  expect_failures = [output.database]
}
run "rejects_wrong_primary_region" {
  command = plan
  override_data {
    target = data.aws_region.primary
    values = { region = "eu-west-3" }
  }
  expect_failures = [output.database]
}
run "rejects_crossed_accounts" {
  command = plan
  override_data {
    target = data.aws_caller_identity.backup
    values = { account_id = "222222222222" }
  }
  expect_failures = [output.database]
}
run "rejects_foreign_key" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-south-2:222222222222:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [output.database]
}
run "rejects_primary_key_in_backup_region" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-west-3:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [output.database]
}
run "rejects_primary_key_for_backup" {
  command = plan
  variables { kms = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-south-2:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [output.database]
}
run "rejects_empty_key" {
  command = plan
  variables { kms = { primary = "", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } }
  expect_failures = [var.kms]
}
run "rejects_two_zones" {
  command = plan
  variables { network = { vpc_id = "vpc-00000000000000001", database_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002" }, service_security_group_id = "sg-00000000000000001" } }
  expect_failures = [var.network]
}
run "rejects_reused_subnet" {
  command = plan
  variables { network = { vpc_id = "vpc-00000000000000001", database_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000001", eus2-az3 = "subnet-00000000000000003" }, service_security_group_id = "sg-00000000000000001" } }
  expect_failures = [var.network]
}
run "rejects_empty_service_firewall" {
  command = plan
  variables { network = { vpc_id = "vpc-00000000000000001", database_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, service_security_group_id = "" } }
  expect_failures = [var.network]
}
run "rejects_foreign_zone" {
  command = plan
  variables { network = { vpc_id = "vpc-00000000000000001", database_subnet_ids = { euw3-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" }, service_security_group_id = "sg-00000000000000001" } }
  expect_failures = [output.database]
}
run "rejects_unknown_scope" {
  command = plan
  variables { scope = "other" }
  expect_failures = [var.scope]
}
run "rejects_small_storage" {
  command = plan
  variables { settings = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 19, max_allocated_storage = 100 } }
  expect_failures = [var.settings]
}
run "rejects_unbounded_storage" {
  command = plan
  variables { settings = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 101 } }
  expect_failures = [var.settings]
}
run "rejects_reversed_storage" {
  command = plan
  variables { settings = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 30, max_allocated_storage = 20 } }
  expect_failures = [var.settings]
}
run "rejects_fractional_storage" {
  command = plan
  variables { settings = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20.5, max_allocated_storage = 100 } }
  expect_failures = [var.settings]
}
run "rejects_empty_engine" {
  command = plan
  variables { settings = { engine_version = "", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 } }
  expect_failures = [var.settings]
}
run "rejects_mismatched_family" {
  command = plan
  variables { settings = { engine_version = "17.6", parameter_family = "postgres16", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 } }
  expect_failures = [var.settings]
}
run "rejects_empty_class" {
  command = plan
  variables { settings = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "", allocated_storage = 20, max_allocated_storage = 100 } }
  expect_failures = [var.settings]
}
