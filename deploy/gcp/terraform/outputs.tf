output "app_url" {
  description = "APP_URL the app is configured with."
  value       = local.app_url
}

output "cloud_run_uri" {
  value = var.deploy_apps ? google_cloud_run_v2_service.web[0].uri : null
}

output "image" {
  description = "Push the image here."
  value       = local.image
}

output "migrate_job_name" {
  value = "${var.name}-migrate"
}

output "sql_connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "database_user" {
  description = "Cloud SQL IAM user the app connects as (DATABASE_URL user)."
  value       = local.db_user
}

output "app_service_account" {
  value = google_service_account.app.email
}

output "scheduler_service_account" {
  value = google_service_account.scheduler.email
}

output "buckets" {
  value = { for b in local.buckets : b => google_storage_bucket.buckets[b].name }
}

# Run once as "postgres" (password in Secret Manager: db-postgres-password)
# before the first migration; see README.
output "cache_host" {
  description = "Memorystore host (empty with cache_enabled = false)."
  value       = var.cache_enabled ? google_redis_instance.cache[0].host : ""
}

output "db_grant_sql" {
  value = <<-SQL
    -- database ${local.database_name}, as postgres
    GRANT cloudsqlsuperuser TO "${local.db_user}";
    DO $$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
        END IF;
      END LOOP;
    END $$;
    GRANT anon, authenticated, service_role TO authenticator;
    GRANT anon, authenticated, service_role TO "${local.db_user}";
  SQL
}
