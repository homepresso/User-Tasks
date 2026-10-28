variable "subscription_id" {
  description = "Azure subscription to deploy into."
  type        = string
}

variable "location" {
  description = "Azure region, e.g. westeurope."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Resource group to create."
  type        = string
  default     = "rg-usertasks"
}

variable "name" {
  description = "Short lowercase name used as a prefix for every resource (3-12 letters/digits)."
  type        = string
  default     = "usertasks"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{2,11}$", var.name))
    error_message = "name must be 3-12 lowercase letters or digits, starting with a letter."
  }
}

variable "deploy_apps" {
  description = "Create the Container App and jobs. Set false for the first apply (registry, database, storage, Key Vault only), push the image, then apply again with true."
  type        = bool
  default     = true
}

variable "image_tag" {
  description = "Tag of the usertasks image in the created Azure Container Registry."
  type        = string
  default     = "latest"
}

variable "app_url" {
  description = "Public origin of the app (custom domain). Empty = the Container App's generated https://<app>.<environment domain>."
  type        = string
  default     = ""
}

variable "instance_admin_emails" {
  description = "Comma-separated INSTANCE_ADMIN_EMAILS (Settings -> Infrastructure, admin CLI)."
  type        = string
  default     = ""
}

variable "auth_provider" {
  description = "AUTH_PROVIDER: builtin (password + optional SSO), oidc or saml."
  type        = string
  default     = "builtin"

  validation {
    condition     = contains(["builtin", "oidc", "saml"], var.auth_provider)
    error_message = "auth_provider must be builtin, oidc or saml (supabase is not part of this profile)."
  }
}

variable "auth_sso_providers" {
  description = "AUTH_SSO_PROVIDERS JSON array (e.g. an Entra ID OIDC preset). Client secrets should be secret://<key-vault-secret-name> references. Empty = none."
  type        = string
  default     = ""
}

variable "postgres_sku" {
  description = "Flexible Server SKU."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  description = "Flexible Server storage in MB."
  type        = number
  default     = 32768
}

variable "postgres_entra_admin" {
  description = "Optional human/group Entra admin for the database server (object_id, principal_name, principal_type User|Group). The app's managed identity is always an admin."
  type = object({
    object_id      = string
    principal_name = string
    principal_type = string
  })
  default = null
}

variable "vnet_address_space" {
  description = "Address space of the virtual network."
  type        = string
  default     = "10.40.0.0/16"
}

variable "container_apps_subnet_prefix" {
  description = "Subnet for the Container Apps environment (workload profiles: /27 or larger)."
  type        = string
  default     = "10.40.0.0/23"
}

variable "postgres_subnet_prefix" {
  description = "Subnet delegated to the PostgreSQL Flexible Server (private access)."
  type        = string
  default     = "10.40.2.0/28"
}

variable "private_endpoint_subnet_prefix" {
  description = "Subnet for private endpoints (Azure Cache for Redis)."
  type        = string
  default     = "10.40.3.0/27"
}

variable "cache_enabled" {
  description = "Azure Cache for Redis as the shared cache (CACHE_PROVIDER=redis); false uses the postgres cache provider (no extra service)."
  type        = bool
  default     = true
}

variable "cache_sku" {
  description = "Azure Cache for Redis SKU: Basic (no replica, no SLA), Standard or Premium."
  type        = string
  default     = "Basic"
  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.cache_sku)
    error_message = "cache_sku must be Basic, Standard or Premium."
  }
}

variable "cache_capacity" {
  description = "Cache size (C0–C6 / P1–P5)."
  type        = number
  default     = 0
}

variable "communication_data_location" {
  description = "Data location of Azure Communication Services (e.g. Europe, United States)."
  type        = string
  default     = "Europe"
}

variable "app_cpu" {
  description = "vCPU per web replica."
  type        = number
  default     = 1
}

variable "app_memory" {
  description = "Memory per web replica (must match the CPU per Container Apps rules)."
  type        = string
  default     = "2Gi"
}

variable "app_min_replicas" {
  description = "Minimum web replicas (>= 1: the SSE realtime stream needs a running instance)."
  type        = number
  default     = 1
}

variable "app_max_replicas" {
  description = "Maximum web replicas."
  type        = number
  default     = 3
}

variable "tags" {
  description = "Tags for every resource."
  type        = map(string)
  default     = { app = "usertasks" }
}
