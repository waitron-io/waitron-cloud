output "delegation" {
  value = var.handoff
  precondition {
    condition     = !can(regex("^[0-9]{12}$", var.expected_account_id)) || var.expected_account_id == data.aws_caller_identity.current.account_id
    error_message = "Only the expected global account may administer the parent delegation"
  }
  precondition {
    condition     = data.aws_region.current.region == "eu-central-1"
    error_message = "Parent delegation must use the global Frankfurt provider"
  }
  precondition {
    condition     = !can(regex("^Z[A-Z0-9]+$", var.handoff.parent_zone_id)) || var.handoff.parent_zone_id == data.aws_route53_zone.parent.zone_id
    error_message = "The public waitron.io lookup must match the supplied parent ID"
  }
}
