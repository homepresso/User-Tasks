output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "app_url" {
  description = "APP_URL the app is configured with."
  value       = local.app_url
}

output "registry_login_server" {
  description = "Push the image here: <server>/usertasks:<tag>."
  value       = azurerm_container_registry.main.login_server
}

output "migrate_job_name" {
  value = "${var.name}-migrate"
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.main.fqdn
}

output "database_user" {
  description = "Entra principal the app connects as (DATABASE_URL user)."
  value       = azurerm_user_assigned_identity.app.name
}

output "managed_identity_client_id" {
  value = azurerm_user_assigned_identity.app.client_id
}

output "key_vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}

output "storage_account" {
  value = azurerm_storage_account.main.name
}

output "cache_hostname" {
  description = "Azure Cache for Redis host (empty with cache_enabled = false)."
  value       = var.cache_enabled ? azurerm_redis_cache.main[0].hostname : ""
}

output "email_from" {
  value = local.mail_from
}
