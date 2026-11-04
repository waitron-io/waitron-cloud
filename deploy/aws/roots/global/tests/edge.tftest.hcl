mock_provider "aws" {
  alias = "global"
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/synthetic/1111111111111111" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZGLOBAL", name_servers = ["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"] } }
  mock_resource "aws_eks_cluster" { defaults = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-central-1.amazonaws.com/id/SYNTHETIC" }] }] } }
  mock_resource "aws_security_group" { defaults = { id = "sg-00000000000000009" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::222222222222:role/synthetic" } }
  mock_resource "aws_launch_template" { defaults = { id = "lt-00000000000000001", latest_version = 1 } }
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
}
mock_provider "aws" {
  alias = "global_backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-west-1" } }
}
mock_provider "aws" {
  alias = "global_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
}
mock_provider "aws" {
  alias = "global_backup_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-west-1" } }
}
variables {
  dns               = { create_zone = false, existing_zone_id = "ZGLOBAL" }
  database          = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 }
  recovery_role_arn = "arn:aws:iam::222222222222:role/waitron-global-recovery"
  compute           = { kubernetes_version = "1.34", operator_role_arns = ["arn:aws:iam::222222222222:role/operators/global-admin"] }
  deployment        = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" } } }
  bindings = {
    "global"             = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }
    "global_backup"      = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-deployment" }
    "global_keys"        = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }
    "global_backup_keys" = { expected_identity = "222222222222", role_arn = "arn:aws:iam::222222222222:role/waitron-global-key-administration" }
  }
}
run "one_cell_keep_exact_ingress_and_scope_dns" {
  command = plan
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = null }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = { "email-key-ring" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, backup_secret_refs = { "email-key-ring" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, replication_role_arn = null }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_global", admin_secret_ref = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-1:222222222222:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { euc1-az1 = "subnet-00000000000000011", euc1-az2 = "subnet-00000000000000012", euc1-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { euc1-az1 = "subnet-00000000000000021", euc1-az2 = "subnet-00000000000000022", euc1-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { euc1-az1 = "rtb-00000000000000001", euc1-az2 = "rtb-00000000000000002", euc1-az3 = "rtb-00000000000000003" }
      cells = {
        "global-01" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000001", euc1-az2 = "subnet-00000000000000002", euc1-az3 = "subnet-00000000000000003" } }
        "global-02" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000004", euc1-az2 = "subnet-00000000000000005", euc1-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["global-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["global-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:loadbalancer/net/global-01/1111111111111111", dns_name = "global-01.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  # JSON is the handoff boundary; empty list element types do not change it.
  assert {
    condition     = jsonencode(output.edge_topology.ingress) == jsonencode({ "global-01" = { dns_name = "global-01.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB1", tcp_ports = tolist([443]), udp_ports = tolist([]), target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/synthetic/1111111111111111" } } })
    error_message = "COMPOSED_CELL_INGRESS: every exact cell needs its own primary ingress and only the agreed public ports: ${jsonencode(output.edge_topology.ingress)}"
  }
  assert {
    condition     = output.edge_topology.dns.zone_id == "ZGLOBAL" && output.edge_topology.dns.name == "waitron.io" && toset(output.edge_topology.dns.name_servers) == toset(["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"])
    error_message = "COMPOSED_SCOPE_DNS: the complete zone handoff must belong only to this scope"
  }
}
run "two_cells_keep_exact_ingress_and_scope_dns" {
  command = plan
  variables { deployment = { version = 1, scope = "global", country = null, primary_region = "eu-central-1", backup_region = "eu-west-1", network = { cidr = "10.10.0.0/16", az_ids = ["euc1-az1", "euc1-az2", "euc1-az3"] }, cells = { "global-01" = { subnet_cidr = "10.10.16.0/20" }, "global-02" = { subnet_cidr = "10.10.32.0/20" } } } }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = null }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-1:222222222222:key/22222222-2222-2222-2222-222222222222" }, secrets = { "email-key-ring" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, backup_secret_refs = { "email-key-ring" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, replication_role_arn = null }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_global", admin_secret_ref = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-central-1:222222222222:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-1:222222222222:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { euc1-az1 = "subnet-00000000000000011", euc1-az2 = "subnet-00000000000000012", euc1-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { euc1-az1 = "subnet-00000000000000021", euc1-az2 = "subnet-00000000000000022", euc1-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { euc1-az1 = "rtb-00000000000000001", euc1-az2 = "rtb-00000000000000002", euc1-az3 = "rtb-00000000000000003" }
      cells = {
        "global-01" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000001", euc1-az2 = "subnet-00000000000000002", euc1-az3 = "subnet-00000000000000003" } }
        "global-02" = { private_subnet_ids = { euc1-az1 = "subnet-00000000000000004", euc1-az2 = "subnet-00000000000000005", euc1-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["global-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["global-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:loadbalancer/net/global-01/1111111111111111", dns_name = "global-01.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  override_resource {
    target = module.cell["global-02"].aws_security_group.node
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = module.ingress["global-02"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:loadbalancer/net/global-02/1111111111111111", dns_name = "global-02.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB2" }
  }
  # JSON is the handoff boundary; empty list element types do not change it.
  assert {
    condition     = jsonencode(output.edge_topology.ingress) == jsonencode({ "global-01" = { dns_name = "global-01.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB1", tcp_ports = tolist([443]), udp_ports = tolist([]), target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/synthetic/1111111111111111" } }, "global-02" = { dns_name = "global-02.eu-central-1.elb.synthetic.invalid", zone_id = "ZLB2", tcp_ports = tolist([443]), udp_ports = tolist([]), target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-central-1:222222222222:targetgroup/synthetic/1111111111111111" } } })
    error_message = "COMPOSED_CELL_INGRESS: every exact cell needs its own primary ingress and only the agreed public ports: ${jsonencode(output.edge_topology.ingress)}"
  }
  assert {
    condition     = output.edge_topology.dns.zone_id == "ZGLOBAL" && output.edge_topology.dns.name == "waitron.io" && toset(output.edge_topology.dns.name_servers) == toset(["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"])
    error_message = "COMPOSED_SCOPE_DNS: the complete zone handoff must belong only to this scope"
  }
}
