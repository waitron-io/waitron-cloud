mock_provider "aws" {
  alias = "global"
  mock_data "aws_caller_identity" { defaults = { account_id = "222222222222" } }
  mock_data "aws_region" { defaults = { region = "eu-central-1" } }
  mock_resource "aws_iam_openid_connect_provider" { defaults = { arn = "arn:aws:iam::222222222222:oidc-provider/oidc.eks.eu-central-1.amazonaws.com/id/0123456789ABCDEF0123456789ABCDEF" } }
}
mock_provider "aws" {
  mock_data "aws_caller_identity" { defaults = { account_id = "333333333333" } }
  mock_data "aws_region" { defaults = { region = "eu-south-2" } }
  mock_resource "aws_iam_openid_connect_provider" { defaults = { arn = "arn:aws:iam::333333333333:oidc-provider/oidc.eks.eu-south-2.amazonaws.com/id/0123456789ABCDEF0123456789ABCDEF" } }
}
variables {
  scope = "es"

  oidc_issuer       = "https://oidc.eks.eu-south-2.amazonaws.com/id/0123456789ABCDEF0123456789ABCDEF"
  namespace         = "waitron-cloud-es"
  cell_name         = "a"
  role_names        = { "api" = "api", "portal" = "portal", "registration-worker" = "registration-worker", "backup-worker" = "backup-worker", "backup-verifier" = "backup-verifier", "remote-gateway" = "remote-gateway", "remote-reconciler" = "remote-reconciler", "monitor-worker" = "monitor-worker" }
  recovery_role_arn = "arn:aws:iam::333333333333:role/waitron-es-recovery"
  prefixes          = { stream = "streams/", snapshot = "snapshots/" }

  custody_refs  = { kms = { storage = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", database = "arn:aws:kms:eu-south-2:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-south-2:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-south-2:333333333333:key/88888888-8888-8888-8888-888888888888" }, backup_kms = { storage = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555", database = "arn:aws:kms:eu-west-3:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-west-3:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-west-3:333333333333:key/88888888-8888-8888-8888-888888888888" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  storage_refs  = { stream_bucket = "waitron-es-stream-333333333333-eu-south-2", snapshot_bucket = "waitron-es-snapshot-333333333333-eu-south-2", backup_buckets = { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" }, kms_key_refs = { primary = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", backup = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" } }
  database_refs = { endpoint = "waitron-es.synthetic.invalid", port = 5432, name = "cloud_es", admin_secret_ref = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-south-2:333333333333:key/66666666-6666-6666-6666-666666666666", backup_ref = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" }
}
run "exact_oidc_audience_and_subject" {
  command = plan
  assert {
    condition     = aws_iam_openid_connect_provider.cell.url == "https://oidc.eks.eu-south-2.amazonaws.com/id/0123456789ABCDEF0123456789ABCDEF" && length(aws_iam_role.workload) == 8 && aws_iam_openid_connect_provider.cell.client_id_list == toset(["sts.amazonaws.com"]) && alltrue([for role, resource in aws_iam_role.workload : jsondecode(resource.assume_role_policy).Statement == [{ Effect = "Allow", Action = "sts:AssumeRoleWithWebIdentity", Principal = { Federated = aws_iam_openid_connect_provider.cell.arn }, Condition = { StringEquals = { ("${trimprefix(var.oidc_issuer, "https://")}:aud") = "sts.amazonaws.com", ("${trimprefix(var.oidc_issuer, "https://")}:sub") = "system:serviceaccount:waitron-cloud-es:${role}" } } }]])
    error_message = "EXACT_OIDC: all eight roles require the exact cell provider, audience and service account"
  }
}
run "country_cannot_read_global" {
  command = plan
  assert {
    condition     = length(aws_iam_role_policy.runtime) == 7 && alltrue([for policy in values(aws_iam_role_policy.runtime) : alltrue([for statement in jsondecode(policy.policy).Statement : !strcontains(jsonencode(statement), "waitron-global") && !strcontains(jsonencode(statement), var.database_refs.admin_secret_ref) && !strcontains(jsonencode(statement), "iam:") && !strcontains(jsonencode(statement), "sts:")])])
    error_message = "RUNTIME_SCOPE: runtime policies cannot read global/admin secrets, change IAM or assume another role"
  }
}
run "rejects_broad_subject_or_principal" {
  command = plan
  variables {
    role_names = { api = "*" }
  }
  expect_failures = [var.role_names]
}
run "rejects_cross_namespace" {
  command = plan
  variables {
    namespace = "../global"
  }
  expect_failures = [var.namespace]
}
run "rejects_unknown_role" {
  command = plan
  variables {
    role_names = { administrator = "administrator" }
  }
  expect_failures = [var.role_names]
}
run "rejects_foreign_issuer" {
  command = plan
  variables {
    oidc_issuer = "https://oidc.eks.eu-central-1.amazonaws.com/id/0123456789ABCDEF0123456789ABCDEF"
  }
  expect_failures = [var.oidc_issuer]
}
run "rejects_wildcard_prefix" {
  command = plan
  variables {
    prefixes = { stream = "*", snapshot = "snapshots/" }
  }
  expect_failures = [var.prefixes]
}
run "rejects_cross_country_prefix" {
  command = plan
  variables {
    prefixes = { stream = "fr/streams/", snapshot = "snapshots/" }
  }
  expect_failures = [var.prefixes]
}
run "rejects_foreign_recovery" {
  command = plan
  variables {
    recovery_role_arn = "arn:aws:iam::222222222222:role/waitron-es-recovery"
  }
  expect_failures = [output.workload_roles]
}
run "rejects_wildcard_cell" {
  command = plan
  variables {
    cell_name = "*"
  }
  expect_failures = [var.cell_name]
}
run "no_broad_allow_permissions" {
  command = plan
  assert {
    condition     = alltrue([for policy in values(aws_iam_role_policy.runtime) : alltrue([for statement in jsondecode(policy.policy).Statement : alltrue([for action in flatten([statement.Action]) : !strcontains(action, "*") && !startswith(action, "iam:") && !startswith(action, "sts:") && !strcontains(action, "DeleteKey") && !strcontains(action, "PutKeyPolicy")]) && alltrue([for ref in flatten([statement.Resource]) : ref != "*" && (can(regex("^arn:aws:(kms|secretsmanager):[a-z0-9-]+:333333333333:", ref)) || can(regex("^arn:aws:s3:::waitron-es-(stream|snapshot)-333333333333-(eu-south-2|eu-west-3)(/(streams|snapshots)/[*])?$", ref)))])])])
    error_message = "NO_BROAD_ALLOWS: policies must keep exact actions and account/region/store/prefix boundaries"
  }
}
run "runtime_secret_least_privilege" {
  command = plan
  assert {
    condition     = alltrue([for role, purposes in { api = ["email-key-ring", "installation-signing", "gateway-signing"], registration-worker = ["email-key-ring", "installation-signing"], backup-worker = ["backup-master-key"], backup-verifier = ["backup-master-key"], remote-gateway = ["gateway-signing", "wireguard"], remote-reconciler = ["gateway-signing"], monitor-worker = ["email-key-ring"] } : try(one([for st in jsondecode(aws_iam_role_policy.runtime[role].policy).Statement : st if st.Sid == "ReadApplicationSecrets"]) == { Sid = "ReadApplicationSecrets", Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [for purpose in purposes : var.custody_refs.secrets[purpose]] } && one([for st in jsondecode(aws_iam_role_policy.runtime[role].policy).Statement : st if st.Sid == "DecryptApplicationSecrets"]) == { Sid = "DecryptApplicationSecrets", Effect = "Allow", Action = ["kms:Decrypt"], Resource = var.custody_refs.kms.secrets, Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.eu-south-2.amazonaws.com", "kms:EncryptionContext:SecretARN" = [for purpose in purposes : var.custody_refs.secrets[purpose]] } } } && length(jsondecode(aws_iam_role_policy.runtime[role].policy).Statement) == (contains(["backup-worker", "backup-verifier"], role) ? 4 : 2), false)])
    error_message = "RUNTIME_SECRETS: each service can read only its named secret purposes through the primary regional key"
  }
}
run "snapshot_worker_and_verifier_permissions" {
  command = plan
  assert {
    condition     = try(one([for st in jsondecode(aws_iam_role_policy.runtime["backup-worker"].policy).Statement : st if st.Sid == "SnapshotObjects"]) == { Sid = "SnapshotObjects", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "arn:aws:s3:::waitron-es-snapshot-333333333333-eu-south-2/snapshots/*" } && one([for st in jsondecode(aws_iam_role_policy.runtime["backup-verifier"].policy).Statement : st if st.Sid == "SnapshotObjects"]) == { Sid = "SnapshotObjects", Effect = "Allow", Action = ["s3:GetObject"], Resource = "arn:aws:s3:::waitron-es-snapshot-333333333333-eu-south-2/snapshots/*" }, false)
    error_message = "SNAPSHOT_ROLES: worker retains catalogue deletion while verifier is read-only and both remain under snapshots/"
  }
}
run "rejects_cross_country_secret" {
  command = plan
  variables {
    custody_refs = { kms = { storage = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", database = "arn:aws:kms:eu-south-2:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-south-2:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-south-2:333333333333:key/88888888-8888-8888-8888-888888888888" }, backup_kms = { storage = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555", database = "arn:aws:kms:eu-west-3:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-west-3:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-west-3:333333333333:key/88888888-8888-8888-8888-888888888888" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-fr/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  expect_failures = [output.workload_roles]
}
run "rejects_foreign_key_account" {
  command = plan
  variables {
    custody_refs = { kms = { storage = "arn:aws:kms:eu-south-2:222222222222:key/44444444-4444-4444-4444-444444444444", database = "arn:aws:kms:eu-south-2:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-south-2:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-south-2:333333333333:key/88888888-8888-8888-8888-888888888888" }, backup_kms = { storage = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555", database = "arn:aws:kms:eu-west-3:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-west-3:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-west-3:333333333333:key/88888888-8888-8888-8888-888888888888" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  expect_failures = [output.workload_roles]
}
run "rejects_reversed_key_regions" {
  command = plan
  variables {
    custody_refs = { kms = { storage = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", database = "arn:aws:kms:eu-south-2:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-south-2:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-south-2:333333333333:key/88888888-8888-8888-8888-888888888888" }, backup_kms = { storage = "arn:aws:kms:eu-west-1:333333333333:key/55555555-5555-5555-5555-555555555555", database = "arn:aws:kms:eu-west-3:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-west-3:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-west-3:333333333333:key/88888888-8888-8888-8888-888888888888" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  expect_failures = [output.workload_roles]
}
run "rejects_global_store" {
  command = plan
  variables {
    storage_refs = { stream_bucket = "waitron-global-stream-333333333333-eu-south-2", snapshot_bucket = "waitron-es-snapshot-333333333333-eu-south-2", backup_buckets = { stream = "waitron-es-stream-333333333333-eu-west-3", snapshot = "waitron-es-snapshot-333333333333-eu-west-3" }, kms_key_refs = { primary = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", backup = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555" } }
  }
  expect_failures = [output.workload_roles]
}
run "rejects_unscoped_replication_role" {
  command = plan
  variables {
    custody_refs = { kms = { storage = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", database = "arn:aws:kms:eu-south-2:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-south-2:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-south-2:333333333333:key/88888888-8888-8888-8888-888888888888" }, backup_kms = { storage = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555", database = "arn:aws:kms:eu-west-3:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-west-3:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-west-3:333333333333:key/88888888-8888-8888-8888-888888888888" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-global-storage-replication" }
  }
  expect_failures = [output.workload_roles]
}
run "rejects_crossed_database_key" {
  command = plan
  variables {
    database_refs = { endpoint = "waitron-es.synthetic.invalid", port = 5432, name = "cloud_es", admin_secret_ref = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-south-2:333333333333:key/99999999-9999-9999-9999-999999999999", backup_ref = "arn:aws:rds:eu-west-3:333333333333:auto-backup:synthetic" }
  }
  expect_failures = [output.workload_roles]
}
run "independent_global_permissions" {
  command   = plan
  providers = { aws = aws.global }
  variables {
    scope             = "global"
    namespace         = "waitron-cloud-global"
    oidc_issuer       = "https://oidc.eks.eu-central-1.amazonaws.com/id/0123456789ABCDEF0123456789ABCDEF"
    role_names        = { api = "api", portal = "portal", registration-worker = "registration-worker", monitor-worker = "monitor-worker" }
    recovery_role_arn = "arn:aws:iam::222222222222:role/waitron-global-recovery"
    storage_refs      = null
    custody_refs      = { kms = { storage = "arn:aws:kms:eu-central-1:222222222222:key/44444444-4444-4444-4444-444444444444", database = "arn:aws:kms:eu-central-1:222222222222:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-central-1:222222222222:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-central-1:222222222222:key/88888888-8888-8888-8888-888888888888" }, backup_kms = { storage = "arn:aws:kms:eu-west-1:222222222222:key/55555555-5555-5555-5555-555555555555", database = "arn:aws:kms:eu-west-1:222222222222:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-west-1:222222222222:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-west-1:222222222222:key/88888888-8888-8888-8888-888888888888" }, secrets = { "email-key-ring" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, backup_secret_refs = { "email-key-ring" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/email-key-ring-ABCDEF", "sign-in-signing" = "arn:aws:secretsmanager:eu-west-1:222222222222:secret:waitron-global/sign-in-signing-ABCDEF" }, replication_role_arn = null }
    database_refs     = { endpoint = "waitron-global.synthetic.invalid", port = 5432, name = "cloud_global", admin_secret_ref = "arn:aws:secretsmanager:eu-central-1:222222222222:secret:admin-ABCDEF", kms_key_ref = "arn:aws:kms:eu-central-1:222222222222:key/66666666-6666-6666-6666-666666666666", backup_ref = "arn:aws:rds:eu-west-1:222222222222:auto-backup:synthetic" }
  }
  assert {
    condition     = length(output.workload_roles) == 4 && length(aws_iam_role_policy.runtime) == 3
    error_message = "GLOBAL_PERMISSIONS: global must operate independently without venue stores, country roles or replication"
  }
}
run "rejects_overlong_cell" {
  command = plan
  variables { cell_name = "aaaaaaaaaaaaaaaaaaaaa" }
  expect_failures = [var.cell_name]
}
run "rejects_extra_key_purpose" {
  command = plan
  variables {
    custody_refs = { kms = { extra = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", storage = "arn:aws:kms:eu-south-2:333333333333:key/44444444-4444-4444-4444-444444444444", database = "arn:aws:kms:eu-south-2:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-south-2:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-south-2:333333333333:key/88888888-8888-8888-8888-888888888888" }, backup_kms = { storage = "arn:aws:kms:eu-west-3:333333333333:key/55555555-5555-5555-5555-555555555555", database = "arn:aws:kms:eu-west-3:333333333333:key/66666666-6666-6666-6666-666666666666", secrets = "arn:aws:kms:eu-west-3:333333333333:key/77777777-7777-7777-7777-777777777777", logs = "arn:aws:kms:eu-west-3:333333333333:key/88888888-8888-8888-8888-888888888888" }, secrets = { "backup-master-key" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-south-2:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, backup_secret_refs = { "backup-master-key" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/backup-master-key-ABCDEF", "email-key-ring" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/email-key-ring-ABCDEF", "gateway-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/gateway-signing-ABCDEF", "wireguard" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/wireguard-ABCDEF", "installation-signing" = "arn:aws:secretsmanager:eu-west-3:333333333333:secret:waitron-es/installation-signing-ABCDEF" }, replication_role_arn = "arn:aws:iam::333333333333:role/waitron-es-storage-replication" }
  }
  expect_failures = [var.custody_refs]
}
