variable "region" {
  description = "AWS region for everything (one-region profile)."
  type        = string
  default     = "eu-west-1"
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

# ── Network (an existing VPC) ───────────────────────────────────────────────

variable "vpc_id" {
  description = "VPC for the load balancer, tasks, database and cache."
  type        = string
}

variable "public_subnet_ids" {
  description = "At least two public subnets (different AZs) for the Application Load Balancer."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "At least two private subnets (different AZs) with a route to AWS APIs (NAT gateway or VPC endpoints) for tasks, RDS and ElastiCache."
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate for HTTPS on the load balancer. Empty = HTTP only (testing)."
  type        = string
  default     = ""
}

variable "app_url" {
  description = "Public origin of the app (custom domain on the load balancer). Empty = http(s)://<ALB DNS name>."
  type        = string
  default     = ""
}

# ── App ─────────────────────────────────────────────────────────────────────

variable "deploy_apps" {
  description = "Create the ECS services, tasks and the tick. false for the first apply (registry, database, cache, buckets, secrets), push the image, then apply again with true."
  type        = bool
  default     = true
}

variable "image_tag" {
  description = "Tag of the usertasks image in the created ECR repository."
  type        = string
  default     = "latest"
}

variable "web_count" {
  description = "Web tasks behind the load balancer (2+ for availability)."
  type        = number
  default     = 2
}

variable "web_cpu" {
  type    = number
  default = 1024
}

variable "web_memory" {
  type    = number
  default = 2048
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
  description = "AUTH_SSO_PROVIDERS JSON array (e.g. the cognito preset); client secrets as secret://<Secrets Manager name>. Empty = none."
  type        = string
  default     = ""
}

# ── Scheduler tick ──────────────────────────────────────────────────────────

variable "tick_mode" {
  description = "scheduler_ecs: EventBridge Scheduler runs `node worker.cjs --once` as an ECS task every minute (IAM only, no endpoint, no shared secret). api_destination: an EventBridge rule POSTs /api/cron/tick through an API destination whose connection sends CRON_SECRET. worker: an always-on worker service."
  type        = string
  default     = "scheduler_ecs"

  validation {
    condition     = contains(["scheduler_ecs", "api_destination", "worker"], var.tick_mode)
    error_message = "tick_mode must be scheduler_ecs, api_destination or worker."
  }
}

# ── Database (RDS for PostgreSQL, IAM database authentication) ──────────────

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_engine_version" {
  type    = string
  default = "16"
}

# ── Cache (ElastiCache for Valkey, IAM auth) ────────────────────────────────

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.small"
}

# ── Email (SES) ─────────────────────────────────────────────────────────────

variable "ses_identity" {
  description = "SES identity to create: a domain (DKIM records to publish are in the ses_dkim_tokens output) or an email address."
  type        = string
}

variable "email_from" {
  description = "EMAIL_FROM, e.g. \"UserTasks <tasks@example.com>\" (an address of ses_identity)."
  type        = string
}

# ── Log export ──────────────────────────────────────────────────────────────

variable "allow_instance_identity_log_export" {
  description = "LOG_EXPORT_ALLOW_INSTANCE_IDENTITY: let log destinations use the task role (auth=instance_role) for the created CloudWatch log group. Only for single-organisation installs: every workspace admin could then ship to that group."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  type    = number
  default = 30
}
