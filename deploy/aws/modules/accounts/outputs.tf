output "member_ids" {
  value     = tomap(merge(var.existing_members, { for scope, member in aws_organizations_account.member : scope => member.id }))
  sensitive = true

  precondition {
    condition     = length(setintersection(toset(keys(var.existing_members)), toset(keys(var.new_members)))) == 0
    error_message = "Existing and new members must use different scopes"
  }

  precondition {
    condition     = alltrue([for id in values(var.existing_members) : id != data.aws_organizations_organization.existing.master_account_id])
    error_message = "Workload members cannot use the Organization management account"
  }

  precondition {
    condition     = length(var.existing_members) + length(var.new_members) == 0 || var.existing_organization_id == data.aws_organizations_organization.existing.id
    error_message = "Member administration must use the supplied existing Organization"
  }

  precondition {
    condition     = alltrue([for id in values(var.existing_members) : contains([for account in data.aws_organizations_organization.existing.accounts : account.id], id)])
    error_message = "Existing member references must belong to the supplied Organization"
  }
}
