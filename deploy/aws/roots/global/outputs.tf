output "deployment_admission" {
  value = {
    version = var.deployment.version
    scope   = var.deployment.scope
    country = var.deployment.country
    regions = { primary = data.aws_region.global.region, backup = data.aws_region.global_backup.region }
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["global"].expected_identity, ""))) || data.aws_caller_identity.global.account_id == try(var.bindings["global"].expected_identity, "")
    error_message = "The actual global provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.global.region == "eu-central-1"
    error_message = "The actual global provider must use its exact primary or cold-copy region"
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["global_backup"].expected_identity, ""))) || data.aws_caller_identity.global_backup.account_id == try(var.bindings["global_backup"].expected_identity, "")
    error_message = "The actual global_backup provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.global_backup.region == "eu-west-1"
    error_message = "The actual global_backup provider must use its exact primary or cold-copy region"
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["global_keys"].expected_identity, ""))) || data.aws_caller_identity.global_keys.account_id == try(var.bindings["global_keys"].expected_identity, "")
    error_message = "The actual global_keys provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.global_keys.region == "eu-central-1"
    error_message = "The actual global_keys provider must use its exact primary or cold-copy region"
  }
  precondition {
    condition     = !can(regex("^[0-9]{12}$", try(var.bindings["global_backup_keys"].expected_identity, ""))) || data.aws_caller_identity.global_backup_keys.account_id == try(var.bindings["global_backup_keys"].expected_identity, "")
    error_message = "The actual global_backup_keys provider must match its externally supplied scope account"
  }
  precondition {
    condition     = data.aws_region.global_backup_keys.region == "eu-west-1"
    error_message = "The actual global_backup_keys provider must use its exact primary or cold-copy region"
  }
}

output "primary_topology" {
  value = {
    network                           = module.network.network
    cells                             = { for name, cell in module.cell : name => cell.cell }
    database_client_security_group_id = aws_security_group.database_clients.id
  }
}
