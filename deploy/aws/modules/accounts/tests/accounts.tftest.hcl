mock_provider "aws" {
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

variables {
  existing_organization_id = "o-abcdefghij"
  parent_ou_id             = "ou-abcd-12345678"
}

run "existing_members_are_references" {
  command = plan
  variables {
    existing_members = { global = "222222222222", es = "333333333333" }
  }
  assert {
    condition     = output.member_ids == tomap({ global = "222222222222", es = "333333333333" })
    error_message = "Existing members must be returned as references"
  }
  assert {
    condition     = length(aws_organizations_account.member) == 0
    error_message = "Existing members must not enter the managed account loop"
  }
}

run "new_members_stay_in_existing_org" {
  command = plan
  variables {
    existing_members = { global = "222222222222" }
    new_members      = { es = { name = "Spain Cloud" } }
    contacts         = { es = "spain-cloud@example.invalid" }
  }
  assert {
    condition     = length(aws_organizations_account.member) == 1 && try(aws_organizations_account.member["es"].parent_id == "ou-abcd-12345678", false)
    error_message = "Only the new Spain member may be created under the supplied parent"
  }
  assert {
    condition     = try(aws_organizations_account.member["es"].name == "Spain Cloud" && aws_organizations_account.member["es"].email == "spain-cloud@example.invalid", false)
    error_message = "New member names and private contacts must use the member key"
  }
  assert {
    condition     = try(aws_organizations_account.member["es"].close_on_deletion == false, false)
    error_message = "Account deletion must never close a managed member"
  }
}

run "rejects_scope_overlap" {
  command = plan
  variables {
    existing_members = { es = "333333333333" }
    new_members      = { es = { name = "Spain Cloud" } }
    contacts         = { es = "spain-cloud@example.invalid" }
  }
  expect_failures = [output.member_ids]
}

run "rejects_management_account" {
  command = plan
  variables {
    existing_members = { global = "111111111111" }
  }
  expect_failures = [output.member_ids]
}

run "rejects_wrong_org" {
  command = plan
  variables {
    existing_organization_id = "o-zyxwvutsrq"
    existing_members         = { global = "222222222222" }
  }
  expect_failures = [output.member_ids]
}

run "rejects_unknown_scope" {
  command = plan
  variables {
    existing_members = { fr = "333333333333" }
  }
  expect_failures = [var.existing_members]
}

run "rejects_unknown_new_scope" {
  command = plan
  variables {
    new_members = { fr = { name = "Unexpected country" } }
    contacts    = { fr = "unexpected@example.invalid" }
  }
  expect_failures = [var.new_members]
}

run "rejects_shared_workload_account" {
  command = plan
  variables {
    existing_members = { global = "222222222222", es = "222222222222" }
  }
  expect_failures = [var.existing_members]
}

run "rejects_malformed_member_id" {
  command = plan
  variables {
    existing_members = { es = "not-an-account" }
  }
  expect_failures = [var.existing_members]
}

run "rejects_member_outside_existing_org" {
  command = plan
  variables {
    existing_members = { es = "555555555555" }
  }
  expect_failures = [output.member_ids]
}
