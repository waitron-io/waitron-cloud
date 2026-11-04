mock_provider "aws" {
  alias = "country"
  mock_resource "aws_lb_target_group" { defaults = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } }
  mock_data "aws_route53_zone" { defaults = { zone_id = "ZSPAIN", name_servers = ["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"] } }
  mock_resource "aws_eks_cluster" { defaults = { identity = [{ oidc = [{ issuer = "https://oidc.eks.eu-south-2.amazonaws.com/id/SYNTHETIC" }] }] } }
  mock_resource "aws_security_group" { defaults = { id = "sg-00000000000000009" } }
  mock_data "aws_availability_zones" { defaults = { zone_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::333333333333:role/synthetic" } }
  mock_resource "aws_launch_template" { defaults = { id = "lt-00000000000000001", latest_version = 1 } }
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}
mock_provider "aws" {
  alias = "country_backup"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
}
mock_provider "aws" {
  alias = "country_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
}
mock_provider "aws" {
  alias = "country_backup_keys"
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-west-3" } }
}
variables {
  dns               = { create_zone = false, existing_zone_id = "ZSPAIN" }
  database          = { engine_version = "17.6", parameter_family = "postgres17", instance_class = "db.t3.small", allocated_storage = 20, max_allocated_storage = 100 }
  recovery_role_arn = "arn:aws:iam::333333333333:role/waitron-es-recovery"
  compute           = { kubernetes_version = "1.34", operator_role_arns = ["arn:aws:iam::333333333333:role/operators/es-admin"] }
  deployment        = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" } } }
  bindings = {
    "country"             = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }
    "country_backup"      = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-deployment" }
    "country_keys"        = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }
    "country_backup_keys" = { expected_identity = "333333333333", role_arn = "arn:aws:iam::333333333333:role/waitron-es-key-administration" }
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
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.storage
    outputs = { storage = { stream_bucket = "waitron-es-stream-333333333333-eu-south-2", snapshot_bucket = "waitron-es-snapshot-333333333333-eu-south-2", backup_buckets = { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" }, kms_key_refs = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } } }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_es", admin_secret_ref = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { eus2-az1 = "subnet-00000000000000011", eus2-az2 = "subnet-00000000000000012", eus2-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { eus2-az1 = "subnet-00000000000000021", eus2-az2 = "subnet-00000000000000022", eus2-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { eus2-az1 = "rtb-00000000000000001", eus2-az2 = "rtb-00000000000000002", eus2-az3 = "rtb-00000000000000003" }
      cells = {
        "es-01" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" } }
        "es-02" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000004", eus2-az2 = "subnet-00000000000000005", eus2-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["es-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/es-01/1111111111111111", dns_name = "es-01.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  # JSON is the handoff boundary; empty list element types do not change it.
  assert {
    condition     = jsonencode(output.edge_topology.ingress) == jsonencode({ "es-01" = { dns_name = "es-01.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB1", tcp_ports = tolist([443]), udp_ports = tolist([51820]), target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111", wireguard = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } })
    error_message = "COMPOSED_CELL_INGRESS: every exact cell needs its own primary ingress and only the agreed public ports: ${jsonencode(output.edge_topology.ingress)}"
  }
  assert {
    condition     = output.edge_topology.dns.zone_id == "ZSPAIN" && output.edge_topology.dns.name == "es.waitron.io" && toset(output.edge_topology.dns.name_servers) == toset(["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"])
    error_message = "COMPOSED_SCOPE_DNS: the complete zone handoff must belong only to this scope"
  }
}
run "two_cells_keep_exact_ingress_and_scope_dns" {
  command = plan
  variables { deployment = { version = 1, scope = "country", country = "es", primary_region = "eu-south-2", backup_region = "eu-west-3", network = { cidr = "10.20.0.0/16", az_ids = ["eus2-az1", "eus2-az2", "eus2-az3"] }, cells = { "es-01" = { subnet_cidr = "10.20.16.0/20" }, "es-02" = { subnet_cidr = "10.20.32.0/20" } } } }
  override_module {
    target  = module.workload_permissions
    outputs = { workload_roles = {}, attachment_refs = {} }
  }
  override_module {
    target  = module.scope_permissions
    outputs = { attachment_refs = {}, permission_admission = true, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.storage
    outputs = { storage = { stream_bucket = "waitron-es-stream-333333333333-eu-south-2", snapshot_bucket = "waitron-es-snapshot-333333333333-eu-south-2", backup_buckets = { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" }, kms_key_refs = { primary = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" } } }
  }
  override_module {
    target  = module.custody
    outputs = { kms = { database = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", storage = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", secrets = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", logs = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111" }, backup_kms = { database = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", storage = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", secrets = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222", logs = "arn:aws:kms:eu-west-3:333333333333:key/22222222-2222-2222-2222-222222222222" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  override_module {
    target  = module.database
    outputs = { database = { endpoint = "synthetic.invalid", port = 5432, name = "cloud_es", admin_secret_ref = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-south-2:333333333333:key/11111111-1111-1111-1111-111111111111", backup_ref = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" } }
  }
  override_module {
    target = module.network
    outputs = { network = {
      vpc_id                  = "vpc-00000000000000001"
      public_subnet_ids       = { eus2-az1 = "subnet-00000000000000011", eus2-az2 = "subnet-00000000000000012", eus2-az3 = "subnet-00000000000000013" }
      database_subnet_ids     = { eus2-az1 = "subnet-00000000000000021", eus2-az2 = "subnet-00000000000000022", eus2-az3 = "subnet-00000000000000023" }
      private_route_table_ids = { eus2-az1 = "rtb-00000000000000001", eus2-az2 = "rtb-00000000000000002", eus2-az3 = "rtb-00000000000000003" }
      cells = {
        "es-01" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000001", eus2-az2 = "subnet-00000000000000002", eus2-az3 = "subnet-00000000000000003" } }
        "es-02" = { private_subnet_ids = { eus2-az1 = "subnet-00000000000000004", eus2-az2 = "subnet-00000000000000005", eus2-az3 = "subnet-00000000000000006" } }
      }
    } }
  }
  override_resource {
    target = module.cell["es-01"].aws_security_group.node
    values = { id = "sg-00000000000000001" }
  }
  override_resource {
    target = module.ingress["es-01"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/es-01/1111111111111111", dns_name = "es-01.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB1" }
  }
  override_resource {
    target = module.cell["es-02"].aws_security_group.node
    values = { id = "sg-00000000000000002" }
  }
  override_resource {
    target = module.ingress["es-02"].aws_lb.cell
    values = { arn = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:loadbalancer/net/es-02/1111111111111111", dns_name = "es-02.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB2" }
  }
  # JSON is the handoff boundary; empty list element types do not change it.
  assert {
    condition     = jsonencode(output.edge_topology.ingress) == jsonencode({ "es-01" = { dns_name = "es-01.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB1", tcp_ports = tolist([443]), udp_ports = tolist([51820]), target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111", wireguard = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } }, "es-02" = { dns_name = "es-02.eu-south-2.elb.synthetic.invalid", zone_id = "ZLB2", tcp_ports = tolist([443]), udp_ports = tolist([51820]), target_group_arns = { https = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111", wireguard = "arn:aws:elasticloadbalancing:eu-south-2:333333333333:targetgroup/synthetic/1111111111111111" } } })
    error_message = "COMPOSED_CELL_INGRESS: every exact cell needs its own primary ingress and only the agreed public ports: ${jsonencode(output.edge_topology.ingress)}"
  }
  assert {
    condition     = output.edge_topology.dns.zone_id == "ZSPAIN" && output.edge_topology.dns.name == "es.waitron.io" && toset(output.edge_topology.dns.name_servers) == toset(["ns-1.synthetic.invalid", "ns-2.synthetic.invalid", "ns-3.synthetic.invalid", "ns-4.synthetic.invalid"])
    error_message = "COMPOSED_SCOPE_DNS: the complete zone handoff must belong only to this scope"
  }
}
