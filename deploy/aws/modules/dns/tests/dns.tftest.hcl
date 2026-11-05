mock_provider "aws" {
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZCOUNTRY123", name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] } }
  mock_resource "aws_route53_zone" { defaults = { zone_id = "ZCOUNTRY123", name_servers = ["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"] } }
}
mock_provider "aws" {
  alias = "global"
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZGLOBAL123", name_servers = ["ns-5.awsdns-5.com", "ns-6.awsdns-6.net", "ns-7.awsdns-7.org", "ns-8.awsdns-8.co.uk"] } }
  mock_resource "aws_route53_zone" { defaults = { zone_id = "ZGLOBAL123", name_servers = ["ns-5.awsdns-5.com", "ns-6.awsdns-6.net", "ns-7.awsdns-7.org", "ns-8.awsdns-8.co.uk"] } }
}
variables {
  scope       = "es"
  zone_name   = "es.waitron.io"
  create_zone = true
}
run "spain_owns_child" {
  command = plan
  assert {
    condition     = length(aws_route53_zone.managed) == 1 && length(data.aws_route53_zone.existing) == 0 && aws_route53_zone.managed[0].name == "es.waitron.io" && aws_route53_zone.managed[0].force_destroy == false && output.dns.zone_id == "ZCOUNTRY123" && output.dns.name == "es.waitron.io" && toset(output.dns.name_servers) == toset(["ns-1.awsdns-1.com", "ns-2.awsdns-2.net", "ns-3.awsdns-3.org", "ns-4.awsdns-4.co.uk"])
    error_message = "SPAIN_ZONE: Spain owns exactly its public child zone and complete NS handoff"
  }
}
run "global_owns_apex" {
  command   = plan
  providers = { aws = aws.global }
  variables {
    scope     = "global"
    zone_name = "waitron.io"
  }
  assert {
    condition     = aws_route53_zone.managed[0].name == "waitron.io" && output.dns.zone_id == "ZGLOBAL123" && output.dns.name == "waitron.io" && length(output.dns.name_servers) == 4
    error_message = "GLOBAL_ZONE: global owns the apex only"
  }
  assert {
    condition     = try(jsondecode(aws_iam_policy.records.policy).Statement[0].Condition["ForAllValues:StringLike"]["route53:ChangeResourceRecordSetsNormalizedRecordNames"] == ["waitron.io"], false)
    error_message = "GLOBAL_NAMES: global runtime record permission covers only the apex"
  }
}
run "adopt_does_not_create_duplicate" {
  command = plan
  variables {
    create_zone      = false
    existing_zone_id = "ZCOUNTRY123"
  }
  assert {
    condition     = length(aws_route53_zone.managed) == 0 && length(data.aws_route53_zone.existing) == 1 && data.aws_route53_zone.existing[0].zone_id == "ZCOUNTRY123" && data.aws_route53_zone.existing[0].name == "es.waitron.io" && data.aws_route53_zone.existing[0].private_zone == false && output.dns.name == "es.waitron.io" && output.dns.zone_id == "ZCOUNTRY123" && length(output.dns.name_servers) == 4
    error_message = "ADOPT_ONLY: explicit adoption references the existing public zone without creating a duplicate"
  }
}
run "country_cannot_edit_apex" {
  command = plan
  assert {
    condition     = jsondecode(aws_iam_policy.records.policy) == { Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["route53:ChangeResourceRecordSets"], Resource = "arn:aws:route53:::hostedzone/ZCOUNTRY123", Condition = { "ForAllValues:StringLike" = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["es.waitron.io", "*.es.waitron.io"] }, "ForAllValues:StringEquals" = { "route53:ChangeResourceRecordSetsRecordTypes" = ["A", "AAAA", "CNAME", "TXT", "CAA"], "route53:ChangeResourceRecordSetsActions" = ["CREATE", "UPSERT", "DELETE"] }, Null = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = "false", "route53:ChangeResourceRecordSetsRecordTypes" = "false", "route53:ChangeResourceRecordSetsActions" = "false" } } }] }
    error_message = "COUNTRY_POLICY: exact zone/name/type/action boundaries must exclude parent, NS and SOA changes"
  }
}

run "rejects_unknown_scope" {
  command = plan
  variables {
    scope = "fr"
  }
  expect_failures = [var.scope]
}

run "country_cannot_adopt_apex" {
  command = plan
  variables {
    zone_name = "waitron.io"
  }
  expect_failures = [var.zone_name]
}

run "global_cannot_own_child" {
  command   = plan
  providers = { aws = aws.global }
  variables {
    scope     = "global"
    zone_name = "es.waitron.io"
  }
  expect_failures = [var.zone_name]
}

run "rejects_other_domain" {
  command = plan
  variables {
    zone_name = "waitron.app"
  }
  expect_failures = [var.zone_name]
}

run "rejects_wildcard_zone" {
  command = plan
  variables {
    zone_name = "*.es.waitron.io"
  }
  expect_failures = [var.zone_name]
}

run "rejects_escaped_zone" {
  command = plan
  variables {
    zone_name = "\\145s.waitron.io"
  }
  expect_failures = [var.zone_name]
}

run "rejects_missing_adoption_id" {
  command = plan
  variables {
    create_zone = false
  }
  expect_failures = [var.existing_zone_id]
}

run "rejects_create_and_adopt" {
  command = plan
  variables {
    existing_zone_id = "ZCOUNTRY123"
  }
  expect_failures = [var.existing_zone_id]
}

run "rejects_malformed_zone_id" {
  command = plan
  variables {
    create_zone      = false
    existing_zone_id = "Z*"
  }
  expect_failures = [var.existing_zone_id]
}

run "rejects_wrong_adoption_id" {
  command = plan
  variables {
    create_zone      = false
    existing_zone_id = "ZOTHER123"
  }
  expect_failures = [output.dns]
}

run "rejects_wrong_home_region" {
  command         = plan
  providers       = { aws = aws.global }
  expect_failures = [output.dns]
}
run "default_adoption_does_not_create" {
  command = plan
  variables {
    create_zone      = null
    existing_zone_id = "ZCOUNTRY123"
  }
  assert {
    condition     = length(aws_route53_zone.managed) == 0 && output.dns.zone_id == "ZCOUNTRY123"
    error_message = "ADOPT_DEFAULT: an unset nullable caller value must use adoption, never create another zone"
  }
}
run "global_adopts_public_apex" {
  command   = plan
  providers = { aws = aws.global }
  variables {
    scope            = "global"
    zone_name        = "waitron.io"
    create_zone      = false
    existing_zone_id = "ZGLOBAL123"
  }
  assert {
    condition     = length(aws_route53_zone.managed) == 0 && output.dns.zone_id == "ZGLOBAL123" && output.dns.name == "waitron.io" && data.aws_route53_zone.existing[0].private_zone == false
    error_message = "APEX_ADOPTION: global must reference its existing public apex without creating one"
  }
}
