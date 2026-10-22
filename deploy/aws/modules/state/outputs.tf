output "custody" {
  value = { bucket_name = aws_s3_bucket.state.bucket, kms_key_ref = aws_kms_key.state.arn, region = var.home_region }
  precondition {
    condition     = var.home_region == data.aws_region.current.region && var.home_region == lookup({ administration = "eu-central-1", global = "eu-central-1", es = "eu-south-2" }, var.scope, "")
    error_message = "State custody must use its scope home region and matching provider region"
  }
  precondition {
    condition     = var.expected_account_id == data.aws_caller_identity.current.account_id
    error_message = "State custody must use the expected account"
  }
  precondition {
    condition     = alltrue([for root in keys(var.deployment_roles) : contains(lookup({ administration = ["accounts", "state"], global = ["global", "state", "delegation"], es = ["country", "state", "delegation"] }, var.scope, []), root)])
    error_message = "Deployment roots must belong to the custody scope"
  }
  precondition {
    condition     = alltrue([for role in values(var.deployment_roles) : try(split(":", role)[4] == var.expected_account_id, false)])
    error_message = "Deployment roles must belong to the state account"
  }
  precondition {
    condition     = try(split(":", var.recovery_role_arn)[4] == var.expected_account_id, false)
    error_message = "Recovery must use a role in the state account"
  }
  precondition {
    condition     = !contains(values(var.deployment_roles), var.recovery_role_arn)
    error_message = "Recovery authority must be separate from deployment roles"
  }
}
