data "aws_organizations_organization" "existing" {}

resource "aws_organizations_account" "member" {
  for_each          = var.new_members
  name              = each.value.name
  email             = var.contacts[each.key]
  parent_id         = var.parent_ou_id
  close_on_deletion = false

  lifecycle {
    prevent_destroy = true
  }
}
