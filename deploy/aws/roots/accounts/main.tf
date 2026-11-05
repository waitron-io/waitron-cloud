module "accounts" {
  source = "../../modules/accounts"
  providers = {
    aws = aws.organization
  }
  existing_organization_id = var.existing_organization_id
  parent_ou_id             = var.parent_ou_id
  existing_members         = var.existing_members
  new_members              = var.new_members
  contacts                 = var.contacts
}
