# UserTasks reference deployment: the "Azure profile".
#
#   web        Container App (node server.js, ingress :3000), user-assigned managed identity
#   tick       Container Apps Job, cron "* * * * *": POST <app>/api/cron/tick with CRON_SECRET
#   migrate    Container Apps Job, manual trigger: node admin.cjs db migrate
#   database   PostgreSQL Flexible Server 16, private access (VNet), Microsoft Entra auth only
#   storage    Storage account (no shared keys, no public blobs), three blob containers
#   secrets    Key Vault (RBAC): encryption-key, cron-secret
#   email      Azure Communication Services + Email Communication Service (Azure-managed domain)
#   logs       Log Analytics workspace for the Container Apps environment
#   registry   Azure Container Registry (pull by managed identity)
#   cache      Azure Cache for Redis (TLS, Microsoft Entra auth only, private
#              endpoint): shared rate limits / invalidations (CACHE_PROVIDER=redis)
#
# Nothing here uses Supabase: DB_PROVIDER=postgres, AUTH_PROVIDER=builtin,
# REALTIME_PROVIDER=sse, SCHEDULER_PROVIDER=external (see docs/infrastructure.md).

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

# 32 random bytes, hex (ENCRYPTION_KEY accepts 64 hex chars or base64).
resource "random_id" "encryption_key" {
  byte_length = 32
}

resource "random_password" "cron_secret" {
  length  = 64
  special = false
}

locals {
  suffix        = random_string.suffix.result
  database_name = "usertasks"
  # Containers usertasks-task-files, usertasks-logos, usertasks-brand-fonts.
  bucket_prefix = "usertasks-"
  buckets       = ["task-files", "logos", "brand-fonts"]
  app_name      = "${var.name}-web"

  app_url   = var.app_url != "" ? trimsuffix(var.app_url, "/") : "https://${local.app_name}.${azurerm_container_app_environment.main.default_domain}"
  image     = "${azurerm_container_registry.main.login_server}/usertasks:${var.image_tag}"
  pg_user   = azurerm_user_assigned_identity.app.name
  pg_fqdn   = azurerm_postgresql_flexible_server.main.fqdn
  db_url    = "postgresql://${local.pg_user}@${local.pg_fqdn}:5432/${local.database_name}?sslmode=require"
  mail_from = "DoNotReply@${azurerm_email_communication_service_domain.managed.mail_from_sender_domain}"

  # Settings shared by the web app and the migration job.
  db_env = {
    DB_PROVIDER   = "postgres"
    DATABASE_URL  = local.db_url
    DATABASE_AUTH = "azure" # Entra token for https://ossrdbms-aad.database.windows.net/.default via DefaultAzureCredential
    # DefaultAzureCredential selects the user-assigned identity by client id.
    AZURE_CLIENT_ID = azurerm_user_assigned_identity.app.client_id
  }

  app_env = merge(local.db_env, {
    DEPLOYMENT_MODE       = "self_hosted"
    APP_URL               = local.app_url
    INSTANCE_ADMIN_EMAILS = var.instance_admin_emails

    AUTH_PROVIDER      = var.auth_provider
    AUTH_SSO_PROVIDERS = var.auth_sso_providers

    REALTIME_PROVIDER = "sse"

    # The tick job below calls POST /api/cron/tick; no in-process worker.
    SCHEDULER_PROVIDER = "external"

    STORAGE_PROVIDER      = "azure_blob"
    AZURE_STORAGE_ACCOUNT = azurerm_storage_account.main.name
    STORAGE_BUCKET_PREFIX = local.bucket_prefix

    EMAIL_PROVIDER     = "azure_communication"
    EMAIL_FROM         = local.mail_from
    ACS_EMAIL_ENDPOINT = "https://${azurerm_communication_service.main.hostname}"

    SECRETS_PROVIDER    = "azure_key_vault"
    AZURE_KEY_VAULT_URL = azurerm_key_vault.main.vault_uri
    # Resolved by the app from Key Vault at startup (fails closed if unreadable).
    ENCRYPTION_KEY = "secret://encryption-key"

    # Shared rate limits / invalidations for every replica: Azure Cache for
    # Redis with an Entra token for the managed identity (username = its
    # object id), else the postgres cache table.
    CACHE_PROVIDER       = var.cache_enabled ? "redis" : "postgres"
    CACHE_REDIS_URL      = var.cache_enabled ? "rediss://${azurerm_redis_cache.main[0].hostname}:${azurerm_redis_cache.main[0].ssl_port}" : ""
    CACHE_REDIS_AUTH     = var.cache_enabled ? "entra" : ""
    CACHE_REDIS_USERNAME = var.cache_enabled ? azurerm_user_assigned_identity.app.principal_id : ""
  })
}

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

# ── Identity ────────────────────────────────────────────────────────────────

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags
}

# ── Logs ────────────────────────────────────────────────────────────────────

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

# ── Network ─────────────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${var.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = [var.vnet_address_space]
  tags                = var.tags
}

resource "azurerm_subnet" "apps" {
  name                 = "snet-apps"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.container_apps_subnet_prefix]

  delegation {
    name = "containerapps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "postgres" {
  name                 = "snet-postgres"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.postgres_subnet_prefix]

  delegation {
    name = "postgres"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_private_dns_zone" "postgres" {
  name                = "${var.name}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "postgres"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.main.id
}

resource "azurerm_subnet" "endpoints" {
  name                 = "snet-endpoints"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.private_endpoint_subnet_prefix]
}

# ── Cache ───────────────────────────────────────────────────────────────────

# Microsoft Entra auth only (no access keys), reached over a private endpoint.
resource "azurerm_redis_cache" "main" {
  count                              = var.cache_enabled ? 1 : 0
  name                               = "redis-${var.name}-${local.suffix}"
  location                           = azurerm_resource_group.main.location
  resource_group_name                = azurerm_resource_group.main.name
  sku_name                           = var.cache_sku
  family                             = var.cache_sku == "Premium" ? "P" : "C"
  capacity                           = var.cache_capacity
  non_ssl_port_enabled               = false
  minimum_tls_version                = "1.2"
  public_network_access_enabled      = false
  access_keys_authentication_enabled = false
  tags                               = var.tags

  redis_configuration {
    active_directory_authentication_enabled = true
    maxmemory_policy                        = "volatile-lru"
  }
}

resource "azurerm_redis_cache_access_policy_assignment" "app" {
  count              = var.cache_enabled ? 1 : 0
  name               = "usertasks-app"
  redis_cache_id     = azurerm_redis_cache.main[0].id
  access_policy_name = "Data Contributor"
  object_id          = azurerm_user_assigned_identity.app.principal_id
  object_id_alias    = azurerm_user_assigned_identity.app.name
}

resource "azurerm_private_dns_zone" "redis" {
  count               = var.cache_enabled ? 1 : 0
  name                = "privatelink.redis.cache.windows.net"
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "redis" {
  count                 = var.cache_enabled ? 1 : 0
  name                  = "redis"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.redis[0].name
  virtual_network_id    = azurerm_virtual_network.main.id
}

resource "azurerm_private_endpoint" "redis" {
  count               = var.cache_enabled ? 1 : 0
  name                = "pe-redis-${var.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.endpoints.id
  tags                = var.tags

  private_service_connection {
    name                           = "redis"
    private_connection_resource_id = azurerm_redis_cache.main[0].id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.redis[0].id]
  }
}

# ── Database ────────────────────────────────────────────────────────────────

resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "psql-${var.name}-${local.suffix}"
  location                      = azurerm_resource_group.main.location
  resource_group_name           = azurerm_resource_group.main.name
  version                       = "16"
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = 7
  delegated_subnet_id           = azurerm_subnet.postgres.id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false
  tags                          = var.tags

  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
    tenant_id                     = data.azurerm_client_config.current.tenant_id
  }

  lifecycle {
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }

  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

# Extensions the migrations create (pg_trgm required, pgcrypto used when present).
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "PG_TRGM,PGCRYPTO"
}

# The app's identity is an Entra admin (member of azure_pg_admin: CREATEROLE),
# so it can run the migrations and own the schema, as docs/infrastructure.md
# requires for managed servers without BYPASSRLS.
resource "azurerm_postgresql_flexible_server_active_directory_administrator" "app" {
  server_name         = azurerm_postgresql_flexible_server.main.name
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  object_id           = azurerm_user_assigned_identity.app.principal_id
  principal_name      = azurerm_user_assigned_identity.app.name
  principal_type      = "ServicePrincipal"

  depends_on = [azurerm_postgresql_flexible_server_configuration.extensions]
}

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "human" {
  count               = var.postgres_entra_admin == null ? 0 : 1
  server_name         = azurerm_postgresql_flexible_server.main.name
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  object_id           = var.postgres_entra_admin.object_id
  principal_name      = var.postgres_entra_admin.principal_name
  principal_type      = var.postgres_entra_admin.principal_type

  depends_on = [azurerm_postgresql_flexible_server_active_directory_administrator.app]
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = local.database_name
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"

  depends_on = [azurerm_postgresql_flexible_server_active_directory_administrator.app]
}

# ── Storage ─────────────────────────────────────────────────────────────────

resource "azurerm_storage_account" "main" {
  name                            = "st${var.name}${local.suffix}"
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  account_tier                    = "Standard"
  account_replication_type        = "ZRS"
  account_kind                    = "StorageV2"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  shared_access_key_enabled       = false # Entra ID (managed identity) only
  allow_nested_items_to_be_public = false # files are served through the app's /files route
  default_to_oauth_authentication = true
  tags                            = var.tags

  blob_properties {
    delete_retention_policy {
      days = 7
    }
    container_delete_retention_policy {
      days = 7
    }
  }
}

resource "azurerm_storage_container" "buckets" {
  for_each              = toset(local.buckets)
  name                  = "${local.bucket_prefix}${each.key}"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "blob_data_contributor" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

# Signed URLs are user-delegation SAS.
resource "azurerm_role_assignment" "blob_delegator" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Delegator"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

# ── Key Vault ───────────────────────────────────────────────────────────────

resource "azurerm_key_vault" "main" {
  name                       = "kv-${var.name}-${local.suffix}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 30
  tags                       = var.tags
}

resource "azurerm_role_assignment" "kv_secrets_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

# Lets the identity running Terraform write the secrets below.
resource "azurerm_role_assignment" "kv_deployer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_secret" "encryption_key" {
  name         = "encryption-key"
  value        = random_id.encryption_key.hex
  key_vault_id = azurerm_key_vault.main.id
  content_type = "ENCRYPTION_KEY (32 bytes, hex)"
  depends_on   = [azurerm_role_assignment.kv_deployer]
}

resource "azurerm_key_vault_secret" "cron_secret" {
  name         = "cron-secret"
  value        = random_password.cron_secret.result
  key_vault_id = azurerm_key_vault.main.id
  content_type = "CRON_SECRET"
  depends_on   = [azurerm_role_assignment.kv_deployer]
}

# ── Email ───────────────────────────────────────────────────────────────────

resource "azurerm_email_communication_service" "main" {
  name                = "ecs-${var.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = var.communication_data_location
  tags                = var.tags
}

# Azure-managed sender domain (<guid>.azurecomm.net). Add a custom domain
# (and its DNS records) for production mail and update EMAIL_FROM.
resource "azurerm_email_communication_service_domain" "managed" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.main.id
  domain_management = "AzureManaged"
  tags              = var.tags
}

resource "azurerm_communication_service" "main" {
  name                = "acs-${var.name}-${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = var.communication_data_location
  tags                = var.tags
}

resource "azurerm_communication_service_email_domain_association" "main" {
  communication_service_id = azurerm_communication_service.main.id
  email_service_domain_id  = azurerm_email_communication_service_domain.managed.id
}

# docs/infrastructure.md: "Contributor, or a narrower custom role" that
# allows Microsoft.Communication/CommunicationServices/Write (send email).
resource "azurerm_role_assignment" "acs_sender" {
  scope                = azurerm_communication_service.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

# ── Registry ────────────────────────────────────────────────────────────────

resource "azurerm_container_registry" "main" {
  name                = "acr${var.name}${local.suffix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Basic"
  admin_enabled       = false
  tags                = var.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
}

# ── Container Apps ──────────────────────────────────────────────────────────

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${var.name}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id   = azurerm_subnet.apps.id
  tags                       = var.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_container_app" "web" {
  count                        = var.deploy_apps ? 1 : 0
  name                         = local.app_name
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  # Key Vault reference: the platform injects the value; it never appears in
  # the app definition.
  secret {
    name                = "cron-secret"
    key_vault_secret_id = azurerm_key_vault_secret.cron_secret.versionless_id
    identity            = azurerm_user_assigned_identity.app.id
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.app_min_replicas
    max_replicas = var.app_max_replicas

    container {
      name   = "web"
      image  = local.image
      cpu    = var.app_cpu
      memory = var.app_memory

      dynamic "env" {
        for_each = { for k, v in local.app_env : k => v if v != "" }
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name        = "CRON_SECRET"
        secret_name = "cron-secret"
      }

      startup_probe {
        transport               = "TCP"
        port                    = 3000
        failure_count_threshold = 10
      }

      liveness_probe {
        transport = "TCP"
        port      = 3000
      }
    }
  }

  depends_on = [
    azurerm_role_assignment.acr_pull,
    azurerm_role_assignment.kv_secrets_user,
    azurerm_role_assignment.blob_data_contributor,
    azurerm_postgresql_flexible_server_database.main,
    azurerm_redis_cache_access_policy_assignment.app,
    azurerm_private_endpoint.redis,
  ]
}

# Per-minute scheduler tick (SCHEDULER_PROVIDER=external). Authenticates with
# the cron secret; see the README for the Entra ID token alternative.
resource "azurerm_container_app_job" "tick" {
  count                        = var.deploy_apps ? 1 : 0
  name                         = "${var.name}-tick"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 120
  replica_retry_limit          = 0
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  schedule_trigger_config {
    cron_expression          = "* * * * *"
    parallelism              = 1
    replica_completion_count = 1
  }

  secret {
    name                = "cron-secret"
    key_vault_secret_id = azurerm_key_vault_secret.cron_secret.versionless_id
    identity            = azurerm_user_assigned_identity.app.id
  }

  template {
    container {
      name    = "tick"
      image   = "docker.io/curlimages/curl:8.10.1"
      cpu     = 0.25
      memory  = "0.5Gi"
      command = ["/bin/sh", "-c"]
      args    = ["curl -fsS --max-time 90 -X POST -H \"Authorization: Bearer $CRON_SECRET\" \"$APP_URL/api/cron/tick\""]

      env {
        name  = "APP_URL"
        value = local.app_url
      }
      env {
        name        = "CRON_SECRET"
        secret_name = "cron-secret"
      }
    }
  }

  depends_on = [azurerm_role_assignment.kv_secrets_user]
}

# One-shot migrations: az containerapp job start -n <name>-migrate -g <rg>
resource "azurerm_container_app_job" "migrate" {
  count                        = var.deploy_apps ? 1 : 0
  name                         = "${var.name}-migrate"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 1800
  replica_retry_limit          = 0
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    container {
      name    = "migrate"
      image   = local.image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "admin.cjs", "db", "migrate"]

      dynamic "env" {
        for_each = local.db_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  depends_on = [
    azurerm_role_assignment.acr_pull,
    azurerm_postgresql_flexible_server_database.main,
  ]
}
