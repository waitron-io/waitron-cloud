data "aws_region" "current" {}
data "aws_route53_zone" "existing" {
  count        = var.create_zone ? 0 : 1
  name         = var.zone_name
  private_zone = false
}
resource "aws_route53_zone" "managed" {
  count         = var.create_zone ? 1 : 0
  name          = var.zone_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
locals {
  zone_id      = var.create_zone ? aws_route53_zone.managed[0].zone_id : data.aws_route53_zone.existing[0].zone_id
  name_servers = var.create_zone ? aws_route53_zone.managed[0].name_servers : data.aws_route53_zone.existing[0].name_servers
}
resource "aws_iam_policy" "records" {
  name = "waitron-${var.scope}-dns-records"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["route53:ChangeResourceRecordSets"]
      Resource = "arn:aws:route53:::hostedzone/${local.zone_id}"
      Condition = {
        "ForAllValues:StringLike" = {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames" = var.scope == "es" ? ["es.waitron.io", "*.es.waitron.io"] : ["waitron.io"]
        }
        "ForAllValues:StringEquals" = {
          "route53:ChangeResourceRecordSetsRecordTypes" = ["A", "AAAA", "CNAME", "TXT", "CAA"]
          "route53:ChangeResourceRecordSetsActions"     = ["CREATE", "UPSERT", "DELETE"]
        }
        Null = {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames" = "false"
          "route53:ChangeResourceRecordSetsRecordTypes"           = "false"
          "route53:ChangeResourceRecordSetsActions"               = "false"
        }
      }
    }]
  })
}
