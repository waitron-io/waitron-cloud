variable "scope" { type = string }
variable "home_region" { type = string }
variable "expected_account_id" { type = string }
variable "deployment_roles" { type = map(string) }
variable "recovery_role_arn" { type = string }
