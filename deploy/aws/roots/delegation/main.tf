data "aws_caller_identity" "current" { provider = aws.global }
data "aws_region" "current" { provider = aws.global }
data "aws_route53_zone" "parent" {
  provider     = aws.global
  name         = "waitron.io"
  private_zone = false
}
resource "aws_route53_record" "country" {
  provider        = aws.global
  zone_id         = var.handoff.parent_zone_id
  name            = var.handoff.child_name
  type            = "NS"
  ttl             = 300
  records         = var.handoff.child_name_servers
  allow_overwrite = false
}
resource "aws_iam_policy" "delegation" {
  provider = aws.global
  name     = "waitron-es-dns-delegation"
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["route53:ChangeResourceRecordSets"], Resource = "arn:aws:route53:::hostedzone/${var.handoff.parent_zone_id}"
    Condition = {
      "ForAllValues:StringEquals" = {
        "route53:ChangeResourceRecordSetsNormalizedRecordNames" = ["es.waitron.io"]
        "route53:ChangeResourceRecordSetsRecordTypes"           = ["NS"]
        "route53:ChangeResourceRecordSetsActions"               = ["CREATE", "UPSERT", "DELETE"]
      }
      Null = { "route53:ChangeResourceRecordSetsNormalizedRecordNames" = "false", "route53:ChangeResourceRecordSetsRecordTypes" = "false", "route53:ChangeResourceRecordSetsActions" = "false" }
    }
  }] })
}
