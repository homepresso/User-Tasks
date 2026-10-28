variable "project_id" {
  description = "Google Cloud project id."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Cloud SQL, Artifact Registry, Cloud Scheduler and the buckets."
  type        = string
  default     = "europe-west1"
}

variable "name" {
  description = "Short lowercase prefix for resource names (3-20 letters, digits, dashes)."
  type        = string
  default     = "usertasks"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.name))
    error_message = "name must be 3-20 lowercase letters, digits or dashes, starting with a letter."
  }
}

variable "bucket_prefix" {
  description = "Globally unique prefix for the GCS bucket names (<prefix>-task-files, -logos, -brand-fonts). Default: <project_id>-<name>."
  type        = string
  default     = ""
}

variable "deploy_apps" {
  description = "Create the Cloud Run service, migration job and scheduler job. false for the first apply (registry, database, buckets, secrets), push the image, then apply again with true."
  type        = bool
  default     = true
}

variable "image_tag" {
  description = "Tag of the usertasks image in the created Artifact Registry repository."
  type        = string
  default     = "latest"
}

variable "app_url" {
  description = "Public origin of the app (custom domain / load balancer). Empty = the Cloud Run URL https://<service>-<project number>.<region>.run.app."
  type        = string
  default     = ""
}

variable "allow_unauthenticated" {
  description = "Grant roles/run.invoker to allUsers (a public web app; the app does its own sign-in). Some organisations forbid this by policy; then front the service with IAP or a load balancer."
  type        = bool
  default     = true
}

variable "instance_admin_emails" {
  description = "Comma-separated INSTANCE_ADMIN_EMAILS."
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
  description = "AUTH_SSO_PROVIDERS JSON array (e.g. the google preset); client secrets as secret://<secret-manager-name>. Empty = none."
  type        = string
  default     = ""
}

# ── Email (SMTP relay) ──────────────────────────────────────────────────────

variable "email_from" {
  description = "EMAIL_FROM, e.g. \"UserTasks <tasks@example.com>\"."
  type        = string
}

variable "smtp_host" {
  description = "SMTP relay host (e.g. smtp-relay.gmail.com, smtp.sendgrid.net). Google Cloud blocks outbound port 25; use 587 or 465."
  type        = string
}

variable "smtp_port" {
  type    = number
  default = 587
}

variable "smtp_starttls" {
  description = "SMTP_STARTTLS: required | opportunistic | off."
  type        = string
  default     = "required"
}

variable "smtp_secure" {
  description = "SMTP_SECURE: true for implicit TLS (port 465)."
  type        = bool
  default     = false
}

variable "smtp_user" {
  description = "SMTP_USER; empty for an IP-allow-listed relay."
  type        = string
  default     = ""
}

variable "smtp_password" {
  description = "SMTP password; stored in Secret Manager as smtp-password and passed as SMTP_PASSWORD=secret://smtp-password. Empty = no password."
  type        = string
  default     = ""
  sensitive   = true
}

# ── Sizing ──────────────────────────────────────────────────────────────────

variable "db_tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_edition" {
  description = "Cloud SQL edition: ENTERPRISE or ENTERPRISE_PLUS."
  type        = string
  default     = "ENTERPRISE"
}

variable "db_disk_size_gb" {
  type    = number
  default = 20
}

variable "db_high_availability" {
  description = "REGIONAL (HA) instead of ZONAL availability."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Protect the Cloud SQL instance and buckets from terraform destroy."
  type        = bool
  default     = true
}

variable "cache_enabled" {
  description = "Memorystore for Redis as the shared cache (CACHE_PROVIDER=redis); false uses the postgres cache provider (no VPC, no extra service)."
  type        = bool
  default     = true
}

variable "cache_tier" {
  description = "Memorystore tier: BASIC (no replica) or STANDARD_HA."
  type        = string
  default     = "BASIC"
  validation {
    condition     = contains(["BASIC", "STANDARD_HA"], var.cache_tier)
    error_message = "cache_tier must be BASIC or STANDARD_HA."
  }
}

variable "cache_memory_gb" {
  description = "Memorystore size in GB."
  type        = number
  default     = 1
}

variable "vpc_subnet_cidr" {
  description = "Subnet for Cloud Run Direct VPC egress (reaches Memorystore); /26 or larger."
  type        = string
  default     = "10.50.0.0/24"
}

variable "app_cpu" {
  type    = string
  default = "1"
}

variable "app_memory" {
  type    = string
  default = "1Gi"
}

variable "app_min_instances" {
  description = "Minimum Cloud Run instances (>= 1 keeps the SSE realtime stream warm)."
  type        = number
  default     = 1
}

variable "app_max_instances" {
  type    = number
  default = 5
}

variable "labels" {
  type    = map(string)
  default = { app = "usertasks" }
}
