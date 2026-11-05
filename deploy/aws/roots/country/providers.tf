provider "aws" {
  alias               = "country"
  region              = "eu-south-2"
  allowed_account_ids = [try(var.bindings["country"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["country"].role_arn, "") }
}
data "aws_caller_identity" "country" { provider = aws.country }
data "aws_region" "country" { provider = aws.country }
provider "aws" {
  alias               = "country_backup"
  region              = "eu-west-3"
  allowed_account_ids = [try(var.bindings["country_backup"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["country_backup"].role_arn, "") }
}
data "aws_caller_identity" "country_backup" { provider = aws.country_backup }
data "aws_region" "country_backup" { provider = aws.country_backup }
provider "aws" {
  alias               = "country_keys"
  region              = "eu-south-2"
  allowed_account_ids = [try(var.bindings["country_keys"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["country_keys"].role_arn, "") }
}
data "aws_caller_identity" "country_keys" { provider = aws.country_keys }
data "aws_region" "country_keys" { provider = aws.country_keys }
provider "aws" {
  alias               = "country_backup_keys"
  region              = "eu-west-3"
  allowed_account_ids = [try(var.bindings["country_backup_keys"].expected_identity, "")]
  assume_role { role_arn = try(var.bindings["country_backup_keys"].role_arn, "") }
}
data "aws_caller_identity" "country_backup_keys" { provider = aws.country_backup_keys }
data "aws_region" "country_backup_keys" { provider = aws.country_backup_keys }
