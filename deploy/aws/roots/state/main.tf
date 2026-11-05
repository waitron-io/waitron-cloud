module "state" {
  source              = "../../modules/state"
  providers           = { aws = aws.state }
  scope               = var.scope
  home_region         = var.home_region
  expected_account_id = var.expected_account_id
  deployment_roles    = var.deployment_roles
  recovery_role_arn   = var.recovery_role_arn
}
