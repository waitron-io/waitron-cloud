data "aws_region" "primary" {}
data "aws_region" "backup" { provider = aws.backup }
data "aws_caller_identity" "primary" {}
data "aws_caller_identity" "backup" { provider = aws.backup }
data "aws_availability_zones" "primary" { state = "available" }

resource "aws_db_subnet_group" "management" {
  name       = "waitron-${var.scope}"
  subnet_ids = values(var.network.database_subnet_ids)
}
resource "aws_security_group" "database" {
  name   = "waitron-${var.scope}-database"
  vpc_id = var.network.vpc_id
}
resource "aws_vpc_security_group_ingress_rule" "postgres" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = var.network.service_security_group_id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
resource "aws_db_parameter_group" "management" {
  name   = "waitron-${var.scope}"
  family = var.settings.parameter_family
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
}
resource "aws_db_instance" "management" {
  identifier                    = "waitron-${var.scope}"
  db_name                       = "cloud_${var.scope}"
  engine                        = "postgres"
  engine_version                = var.settings.engine_version
  instance_class                = var.settings.instance_class
  allocated_storage             = var.settings.allocated_storage
  max_allocated_storage         = var.settings.max_allocated_storage
  storage_type                  = "gp3"
  storage_encrypted             = true
  kms_key_id                    = var.kms.primary
  master_user_secret_kms_key_id = var.kms.primary
  manage_master_user_password   = true
  username                      = "cloud_admin"
  multi_az                      = true
  publicly_accessible           = false
  port                          = 5432
  db_subnet_group_name          = aws_db_subnet_group.management.name
  vpc_security_group_ids        = [aws_security_group.database.id]
  parameter_group_name          = aws_db_parameter_group.management.name
  backup_retention_period       = var.retention.primary
  deletion_protection           = true
  skip_final_snapshot           = false
  final_snapshot_identifier     = "waitron-${var.scope}-final"
  delete_automated_backups      = false
  copy_tags_to_snapshot         = true
  lifecycle { prevent_destroy = true }
}
