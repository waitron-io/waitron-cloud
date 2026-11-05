mock_provider "aws" {
  alias = "global"
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZGLOBAL123", name_servers = ["ns-5.awsdns-5.com", "ns-6.awsdns-6.net", "ns-7.awsdns-7.org", "ns-8.awsdns-8.co.uk"] } }
}
variables {
  expected_account_id = "222222222222"
  handoff             = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
}
run "parent_contains_exact_child_ns" {
  command = plan
  assert {
    condition     = data.aws_route53_zone.parent.name == "waitron.io" && data.aws_route53_zone.parent.private_zone == false && aws_route53_record.country.zone_id == "ZGLOBAL123" && aws_route53_record.country.name == "es.waitron.io" && aws_route53_record.country.type == "NS" && aws_route53_record.country.ttl == 300 && aws_route53_record.country.allow_overwrite == false && toset(aws_route53_record.country.records) == toset(["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"])
    error_message = "EXACT_DELEGATION: only the handed-off child NS set goes into the explicit parent without overwriting"
  }
  assert {
    condition     = output.delegation == { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = toset(["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"]) }
    error_message = "DELEGATION_HANDOFF: preserve exactly the admitted versioned handoff"
  }
}
run "delegation_policy_has_no_other_records" {
  command = plan
  assert {
    condition     = jsondecode(aws_iam_policy.delegation.policy) == { Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["route53:ChangeResourceRecordSets"], Resource = "arn:aws:route53:::hostedzone/ZGLOBAL123", Condition = { "ForAllValues:StringEquals" = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["es.waitron.io"], "route53:ChangeResourceRecordSetsRecordTypes" = ["NS"], "route53:ChangeResourceRecordSetsActions" = ["CREATE", "UPSERT", "DELETE"] }, Null = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = "false", "route53:ChangeResourceRecordSetsRecordTypes" = "false", "route53:ChangeResourceRecordSetsActions" = "false" } } }] }
    error_message = "DELEGATION_POLICY: delegation changes only Spain NS in the exact global zone"
  }
}

run "rejects_wrong_version" {
  command = plan
  variables {
    handoff = { version = 2, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_wrong_child" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_child_suffix_attack" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io.attacker.invalid", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_wildcard_child" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "*.es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_malformed_parent" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "Z*", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_missing_ns" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_duplicate_ns" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-1.awsdns-1.com", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_foreign_ns" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.attacker.invalid", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_wildcard_ns" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["*.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_ns_suffix_attack" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com.attacker.invalid", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_same_ns_suffix" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.com", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [var.handoff]
}

run "rejects_wrong_parent_id" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZOTHER123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] }
  }
  expect_failures = [output.delegation]
}

run "rejects_wrong_global_account" {
  command = plan
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "333333333333" }
  }
  expect_failures = [output.delegation]
}

run "rejects_wrong_global_region" {
  command = plan
  override_data {
    target = data.aws_region.current
    values = { region = "eu-south-2" }
  }
  expect_failures = [output.delegation]
}

run "rejects_malformed_account" {
  command = plan
  variables {
    expected_account_id = "*"
  }
  expect_failures = [var.expected_account_id]
}

run "rejects_fifth_distinct_ns" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk", "ns-5.awsdns-5.com"] }
  }
  expect_failures = [var.handoff]
}
run "accepts_absolute_nameservers" {
  command = plan
  variables {
    handoff = { version = 1, parent_zone_id = "ZGLOBAL123", child_name = "es.waitron.io", child_name_servers = ["ns-1.awsdns-1.com.", "ns-2.awsdns-2.net.", "ns-3.awsdns-3.org.", "ns-4.awsdns-4.co.uk."] }
  }
  assert {
    condition     = toset(aws_route53_record.country.records) == toset(["ns-1.awsdns-1.com.", "ns-2.awsdns-2.net.", "ns-3.awsdns-3.org.", "ns-4.awsdns-4.co.uk."])
    error_message = "ABSOLUTE_NS: valid absolute nameservers preserve their exact delegation values"
  }
}
