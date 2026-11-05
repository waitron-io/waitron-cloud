provider "aws" {
  alias               = "global"
  region              = "eu-central-1"
  allowed_account_ids = [try(var.bindings["global"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["global"].role_arn, "") }
}
data "aws_caller_identity" "global" { provider = aws.global }
data "aws_region" "global" { provider = aws.global }
provider "aws" {
  alias               = "global_backup"
  region              = "eu-west-1"
  allowed_account_ids = [try(var.bindings["global_backup"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["global_backup"].role_arn, "") }
}
data "aws_caller_identity" "global_backup" { provider = aws.global_backup }
data "aws_region" "global_backup" { provider = aws.global_backup }
provider "aws" {
  alias               = "global_keys"
  region              = "eu-central-1"
  allowed_account_ids = [try(var.bindings["global_keys"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["global_keys"].role_arn, "") }
}
data "aws_caller_identity" "global_keys" { provider = aws.global_keys }
data "aws_region" "global_keys" { provider = aws.global_keys }
provider "aws" {
  alias               = "global_backup_keys"
  region              = "eu-west-1"
  allowed_account_ids = [try(var.bindings["global_backup_keys"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["global_backup_keys"].role_arn, "") }
}
data "aws_caller_identity" "global_backup_keys" { provider = aws.global_backup_keys }
data "aws_region" "global_backup_keys" { provider = aws.global_backup_keys }
