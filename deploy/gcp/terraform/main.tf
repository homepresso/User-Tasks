# UserTasks reference deployment: the "GCP profile".
#
#   web        Cloud Run service (node server.js, port 3000), dedicated service account
#   migrate    Cloud Run job: node admin.cjs db migrate
#   tick       Cloud Scheduler job, "* * * * *": POST <app>/api/cron/tick with a Google OIDC token
#   database   Cloud SQL for PostgreSQL 16, IAM database authentication, connector-only access
#   storage    Three GCS buckets (uniform access, public access prevention)
#   secrets    Secret Manager: encryption-key, cron-secret, smtp-password, db-postgres-password
#   email      SMTP relay (variables)
#   registry   Artifact Registry Docker repository
#   cache      Memorystore for Redis (AUTH + TLS, private: Cloud Run Direct VPC
#              egress): shared rate limits / invalidations (CACHE_PROVIDER=redis)
#
# Nothing here uses Supabase: DB_PROVIDER=postgres, AUTH_PROVIDER=builtin,
# REALTIME_PROVIDER=sse, SCHEDULER_PROVIDER=external (see docs/infrastructure.md).

data "google_project" "this" {
  project_id = var.project_id
  depends_on = [google_project_service.apis]
}

locals {
  apis = [
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # signBlob for V4 signed URLs
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ]

  service_name  = "${var.name}-web"
  database_name = "usertasks"
  bucket_prefix = var.bucket_prefix != "" ? var.bucket_prefix : "${var.project_id}-${var.name}"
  buckets       = ["task-files", "logos", "brand-fonts"]

  app_url = var.app_url != "" ? trimsuffix(var.app_url, "/") : "https://${local.service_name}-${data.google_project.this.number}.${var.region}.run.app"
  image   = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}/usertasks:${var.image_tag}"

  # Cloud SQL IAM user for a service account: its email without ".gserviceaccount.com".
  db_user       = trimsuffix(google_service_account.app.email, ".gserviceaccount.com")
  db_connection = google_sql_database_instance.main.connection_name
  # Unix socket of the built-in Cloud SQL connection (Cloud SQL Auth Proxy
  # managed by Cloud Run; it encrypts the connection, so no sslmode here).
  db_url = "postgresql://${urlencode(local.db_user)}@/${local.database_name}?host=/cloudsql/${local.db_connection}"

  db_env = {
    DB_PROVIDER   = "postgres"
    DATABASE_URL  = local.db_url
    DATABASE_AUTH = "gcp" # ADC access token of the attached service account is the password
  }

  app_env = merge(local.db_env, {
    DEPLOYMENT_MODE       = "self_hosted"
    APP_URL               = local.app_url
    INSTANCE_ADMIN_EMAILS = var.instance_admin_emails

    AUTH_PROVIDER      = var.auth_provider
    AUTH_SSO_PROVIDERS = var.auth_sso_providers

    REALTIME_PROVIDER = "sse"

    # Cloud Scheduler calls the tick with an OIDC token; the app verifies
    # Google's signature, the audience and the service account.
    SCHEDULER_PROVIDER              = "external"
    SCHEDULER_OIDC_SERVICE_ACCOUNTS = google_service_account.scheduler.email
    SCHEDULER_OIDC_AUDIENCE         = "${local.app_url}/api/cron/tick"

    STORAGE_PROVIDER   = "gcs"
    GCS_PROJECT_ID     = var.project_id
    STORAGE_BUCKET_MAP = jsonencode({ for b in local.buckets : b => google_storage_bucket.buckets[b].name })

    EMAIL_PROVIDER = "smtp"
    EMAIL_FROM     = var.email_from
    SMTP_HOST      = var.smtp_host
    SMTP_PORT      = tostring(var.smtp_port)
    SMTP_SECURE    = tostring(var.smtp_secure)
    SMTP_STARTTLS  = var.smtp_starttls
    SMTP_USER      = var.smtp_user
    SMTP_PASSWORD  = local.smtp_password_set ? "secret://smtp-password" : ""

    SECRETS_PROVIDER           = "gcp_secret_manager"
    GCP_SECRET_MANAGER_PROJECT = var.project_id
    # Resolved by the app from Secret Manager at startup (fails closed if unreadable).
    ENCRYPTION_KEY = "secret://encryption-key"

    # Shared rate limits / invalidations for every instance: Memorystore over
    # TLS with its AUTH string from Secret Manager and its server CA mounted
    # from Secret Manager; else the postgres cache table.
    CACHE_PROVIDER          = var.cache_enabled ? "redis" : "postgres"
    CACHE_REDIS_URL         = var.cache_enabled ? "rediss://${google_redis_instance.cache[0].host}:${google_redis_instance.cache[0].port}" : ""
    CACHE_REDIS_PASSWORD    = var.cache_enabled ? "secret://redis-auth" : ""
    CACHE_REDIS_TLS_CA_FILE = var.cache_enabled ? "/etc/usertasks/redis-ca/ca.pem" : ""
  })

  # Whether a password is set is not itself secret.
  smtp_password_set = nonsensitive(var.smtp_password != "")
  secret_names = concat(
    ["encryption-key", "cron-secret"],
    local.smtp_password_set ? ["smtp-password"] : [],
    var.cache_enabled ? ["redis-auth", "redis-ca"] : [],
  )
  secret_values = {
    "encryption-key" = random_id.encryption_key.hex
    "cron-secret"    = random_password.cron_secret.result
    "smtp-password"  = var.smtp_password
    "redis-auth"     = var.cache_enabled ? google_redis_instance.cache[0].auth_string : ""
    "redis-ca"       = var.cache_enabled ? google_redis_instance.cache[0].server_ca_certs[0].cert : ""
  }
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

# ── Service accounts ────────────────────────────────────────────────────────

resource "google_service_account" "app" {
  account_id   = "${var.name}-app"
  display_name = "UserTasks app (Cloud Run service and jobs)"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "scheduler" {
  account_id   = "${var.name}-scheduler"
  display_name = "UserTasks scheduler tick (Cloud Scheduler OIDC)"
  depends_on   = [google_project_service.apis]
}

resource "google_project_iam_member" "app_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = google_service_account.app.member
}

resource "google_project_iam_member" "app_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = google_service_account.app.member
}

# iam.serviceAccounts.signBlob on itself: V4 signed URLs for GCS.
resource "google_service_account_iam_member" "app_sign_blob" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.app.member
}

# ── Registry ────────────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"
  description   = "UserTasks images"
  labels        = var.labels
  depends_on    = [google_project_service.apis]
}

# ── Database ────────────────────────────────────────────────────────────────

resource "random_password" "db_postgres" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "main" {
  name                = "${var.name}-pg"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    tier              = var.db_tier
    edition           = var.db_edition
    availability_type = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_size         = var.db_disk_size_gb
    disk_autoresize   = true
    user_labels       = var.labels

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    ip_configuration {
      # Public IP with no authorized networks: reachable only through the Cloud
      # SQL connector / Auth Proxy, which require IAM and client certificates.
      ipv4_enabled = true
      ssl_mode     = "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }

    insights_config {
      query_insights_enabled = true
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "main" {
  name     = local.database_name
  instance = google_sql_database_instance.main.name
}

# Built-in superuser-like account, only for the one-time grant in the README.
resource "google_sql_user" "postgres" {
  name     = "postgres"
  instance = google_sql_database_instance.main.name
  password = random_password.db_postgres.result
  # Cloud SQL can't drop the built-in postgres user / a user owning objects.
  deletion_policy = "ABANDON"
}

resource "google_sql_user" "app" {
  name            = local.db_user
  instance        = google_sql_database_instance.main.name
  type            = "CLOUD_IAM_SERVICE_ACCOUNT"
  deletion_policy = "ABANDON"
}

# ── Storage ─────────────────────────────────────────────────────────────────

resource "google_storage_bucket" "buckets" {
  for_each                    = toset(local.buckets)
  name                        = "${local.bucket_prefix}-${each.key}"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced" # files are served through the app's /files route
  force_destroy               = !var.deletion_protection
  labels                      = var.labels

  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "app_object_admin" {
  for_each = google_storage_bucket.buckets
  bucket   = each.value.name
  role     = "roles/storage.objectAdmin"
  member   = google_service_account.app.member
}

# ── Secrets ─────────────────────────────────────────────────────────────────

# 32 random bytes, hex (ENCRYPTION_KEY accepts 64 hex chars or base64).
resource "random_id" "encryption_key" {
  byte_length = 32
}

resource "random_password" "cron_secret" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "app" {
  for_each  = toset(local.secret_names)
  secret_id = each.key
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = google_secret_manager_secret.app
  secret      = each.value.id
  secret_data = local.secret_values[each.key]
}

resource "google_secret_manager_secret_iam_member" "app_accessor" {
  for_each  = google_secret_manager_secret.app
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.app.member
}

# Not readable by the app: for the operator's one-time database grant.
resource "google_secret_manager_secret" "db_postgres_password" {
  secret_id = "db-postgres-password"
  labels    = var.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_postgres_password" {
  secret      = google_secret_manager_secret.db_postgres_password.id
  secret_data = random_password.db_postgres.result
}

# ── Network and cache ───────────────────────────────────────────────────────

# A VPC for Memorystore; Cloud Run reaches it with Direct VPC egress (private
# ranges only, so everything else still leaves through Google's network).
resource "google_compute_network" "main" {
  count                   = var.cache_enabled ? 1 : 0
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "run" {
  count                    = var.cache_enabled ? 1 : 0
  name                     = "${var.name}-run"
  region                   = var.region
  network                  = google_compute_network.main[0].id
  ip_cidr_range            = var.vpc_subnet_cidr
  private_ip_google_access = true
}

resource "google_redis_instance" "cache" {
  count                   = var.cache_enabled ? 1 : 0
  name                    = "${var.name}-cache"
  region                  = var.region
  tier                    = var.cache_tier
  memory_size_gb          = var.cache_memory_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = google_compute_network.main[0].id
  connect_mode            = "DIRECT_PEERING"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  redis_configs = {
    maxmemory-policy = "volatile-lru"
  }
  labels     = var.labels
  depends_on = [google_project_service.apis]
}

# ── Cloud Run ───────────────────────────────────────────────────────────────

resource "google_cloud_run_v2_service" "web" {
  count               = var.deploy_apps ? 1 : 0
  name                = local.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false
  labels              = var.labels

  template {
    service_account = google_service_account.app.email
    timeout         = "3600s" # SSE realtime streams

    scaling {
      min_instance_count = var.app_min_instances
      max_instance_count = var.app_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.db_connection]
      }
    }

    dynamic "volumes" {
      for_each = var.cache_enabled ? [1] : []
      content {
        name = "redis-ca"
        secret {
          secret = google_secret_manager_secret.app["redis-ca"].secret_id
          items {
            version = "latest"
            path    = "ca.pem"
          }
        }
      }
    }

    dynamic "vpc_access" {
      for_each = var.cache_enabled ? [1] : []
      content {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.main[0].id
          subnetwork = google_compute_subnetwork.run[0].id
        }
      }
    }

    containers {
      image = local.image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = var.app_cpu
          memory = var.app_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = { for k, v in local.app_env : k => v if v != "" }
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secret Manager reference resolved by Cloud Run (the app reads
      # CRON_SECRET as a plain value).
      env {
        name = "CRON_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.app["cron-secret"].secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "volume_mounts" {
        for_each = var.cache_enabled ? [1] : []
        content {
          name       = "redis-ca"
          mount_path = "/etc/usertasks/redis-ca"
        }
      }

      startup_probe {
        tcp_socket {
          port = 3000
        }
        period_seconds    = 5
        failure_threshold = 24
      }
    }
  }

  depends_on = [
    google_project_iam_member.app_sql_client,
    google_project_iam_member.app_sql_instance_user,
    google_secret_manager_secret_iam_member.app_accessor,
    google_secret_manager_secret_version.app,
    google_sql_user.app,
    google_sql_database.main,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.deploy_apps && var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.web[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# One-shot migrations: gcloud run jobs execute <name>-migrate --region <region> --wait
resource "google_cloud_run_v2_job" "migrate" {
  count               = var.deploy_apps ? 1 : 0
  name                = "${var.name}-migrate"
  location            = var.region
  deletion_protection = false
  labels              = var.labels

  template {
    task_count = 1

    template {
      service_account = google_service_account.app.email
      max_retries     = 0
      timeout         = "1800s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.db_connection]
        }
      }

      containers {
        image   = local.image
        command = ["node"]
        args    = ["admin.cjs", "db", "migrate"]

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }

        dynamic "env" {
          for_each = local.db_env
          content {
            name  = env.key
            value = env.value
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.app_sql_client,
    google_project_iam_member.app_sql_instance_user,
    google_sql_user.app,
    google_sql_database.main,
  ]
}

# ── Scheduler tick ──────────────────────────────────────────────────────────

resource "google_cloud_scheduler_job" "tick" {
  count            = var.deploy_apps ? 1 : 0
  name             = "${var.name}-tick"
  region           = var.region
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "120s"

  retry_config {
    retry_count = 0 # the next minute's tick catches up
  }

  http_target {
    http_method = "POST"
    uri         = "${local.app_url}/api/cron/tick"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = "${local.app_url}/api/cron/tick"
    }
  }

  depends_on = [google_cloud_run_v2_service.web]
}
