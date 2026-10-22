mock_provider "aws" {
  alias = "organization"
  mock_data "aws_organizations_organization" {
    defaults = {
      id                = "o-abcdefghij"
      master_account_id = "111111111111"
      accounts = [
        {
          id               = "111111111111"
          arn              = "arn:aws:organizations::111111111111:account/o-abcdefghij/111111111111"
          email            = "administration@example.invalid"
          name             = "Synthetic administration"
          joined_method    = "CREATED"
          joined_timestamp = "2026-01-01T00:00:00Z"
          state            = "ACTIVE"
          status           = "ACTIVE"
        },
        {
          id               = "222222222222"
          arn              = "arn:aws:organizations::111111111111:account/o-abcdefghij/222222222222"
          email            = "global@example.invalid"
          name             = "Synthetic global"
          joined_method    = "CREATED"
          joined_timestamp = "2026-01-01T00:00:00Z"
          state            = "ACTIVE"
          status           = "ACTIVE"
        },
        {
          id               = "333333333333"
          arn              = "arn:aws:organizations::111111111111:account/o-abcdefghij/333333333333"
          email            = "spain@example.invalid"
          name             = "Synthetic spain"
          joined_method    = "CREATED"
          joined_timestamp = "2026-01-01T00:00:00Z"
          state            = "ACTIVE"
          status           = "ACTIVE"
        }
      ]
    }
  }
  mock_resource "aws_organizations_account" {
    defaults = {
      id = "444444444444"
    }
  }
}

run "existing_members_are_references" {
  command = plan
  variables {
    existing_organization_id = "o-abcdefghij"
    parent_ou_id             = "ou-abcd-12345678"
    existing_members         = { global = "222222222222", es = "333333333333" }
  }
  assert {
    condition     = output.member_ids == tomap({ global = "222222222222", es = "333333333333" })
    error_message = "The administration root must return existing member references"
  }
}

run "new_members_stay_in_existing_org" {
  command = plan
  variables {
    existing_organization_id = "o-abcdefghij"
    parent_ou_id             = "ou-abcd-12345678"
    existing_members         = { global = "222222222222" }
    new_members              = { es = { name = "Spain Cloud" } }
    contacts                 = { es = "spain-cloud@example.invalid" }
  }
  assert {
    condition     = toset(keys(output.member_ids)) == toset(["global", "es"])
    error_message = "The administration root must combine existing and new member references"
  }
}
