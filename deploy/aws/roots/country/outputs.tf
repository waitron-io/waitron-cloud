output "deployment_admission" {
  value = {
    version = var.deployment.version
    scope   = var.deployment.scope
    country = var.deployment.country
    regions = { primary = data.aws_region.country.region, backup = data.aws_region.country_backup.region }
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["country"].expected_identity, ""))) || data.aws_caller_identity.country.account_id == try(var.bindings["country"].expected_identity, "")
    error_message = "The actual country provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.country.region == "eu-south-2"
    error_message = "The actual country provider must use its exact primary or cold-copy region"
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["country_backup"].expected_identity, ""))) || data.aws_caller_identity.country_backup.account_id == try(var.bindings["country_backup"].expected_identity, "")
    error_message = "The actual country_backup provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.country_backup.region == "eu-west-3"
    error_message = "The actual country_backup provider must use its exact primary or cold-copy region"
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["country_keys"].expected_identity, ""))) || data.aws_caller_identity.country_keys.account_id == try(var.bindings["country_keys"].expected_identity, "")
    error_message = "The actual country_keys provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.country_keys.region == "eu-south-2"
    error_message = "The actual country_keys provider must use its exact primary or cold-copy region"
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["country_backup_keys"].expected_identity, ""))) || data.aws_caller_identity.country_backup_keys.account_id == try(var.bindings["country_backup_keys"].expected_identity, "")
    error_message = "The actual country_backup_keys provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.country_backup_keys.region == "eu-west-3"
    error_message = "The actual country_backup_keys provider must use its exact primary or cold-copy region"
  }
}

output "primary_topology" {
  value = {
    network                           = module.network.network
    cells                             = { for name, cell in module.cell : name => cell.cell }
    database_client_security_group_id = aws_security_group.database_clients.id
  }
}

output "data_topology" {
  value = {
    database           = module.database.database
    keys               = module.custody.kms
    backup_keys        = module.custody.backup_kms
    secret_refs        = module.custody.secrets
    backup_secret_refs = module.custody.backup_secret_refs
  }
}
