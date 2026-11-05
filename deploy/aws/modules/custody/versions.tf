terraform {
  required_version = "= 1.13.2"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "6.70.0"
      configuration_aliases = [aws.backup, aws.keys, aws.backup_keys]
    }
  }
}
