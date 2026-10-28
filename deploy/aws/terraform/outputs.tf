output "app_url" {
  description = "APP_URL the app is configured with."
  value       = local.app_url
}

output "load_balancer_dns_name" {
  value = aws_lb.web.dns_name
}

output "image" {
  description = "Push the image here."
  value       = local.image
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "admin_task_definition" {
  description = "Run with overridden commands for migrate / bootstrap / doctor (see README)."
  value       = var.deploy_apps ? aws_ecs_task_definition.admin[0].family : null
}

output "private_subnet_ids" {
  value = var.private_subnet_ids
}

output "tasks_security_group" {
  value = aws_security_group.tasks.id
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

output "database_user" {
  description = "RDS IAM user the app connects as (DATABASE_URL user)."
  value       = local.db_user
}

output "database_master_secret_arn" {
  description = "Secrets Manager secret with the RDS master password (operator only; for the one-time grant)."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "cache_endpoint" {
  value = aws_elasticache_replication_group.cache.primary_endpoint_address
}

output "buckets" {
  value = { for b in local.buckets : b => aws_s3_bucket.buckets[b].bucket }
}

output "log_export_group" {
  description = "Log group for an aws_cloudwatch_logs destination with auth instance_role."
  value       = aws_cloudwatch_log_group.events.name
}

output "ses_dkim_tokens" {
  description = "Publish CNAMEs <token>._domainkey.<domain> → <token>.dkim.amazonses.com (domain identities)."
  value       = try(aws_sesv2_email_identity.app.dkim_signing_attributes[0].tokens, [])
}

# Run once as the master user "postgres" before the first migration; see README.
output "db_grant_sql" {
  value = <<-SQL
    -- database ${local.database_name}, as postgres
    CREATE ROLE ${local.db_user} LOGIN;
    GRANT rds_iam TO ${local.db_user};
    GRANT rds_superuser TO ${local.db_user};
    ALTER DATABASE ${local.database_name} OWNER TO ${local.db_user};
    ALTER SCHEMA public OWNER TO ${local.db_user};
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
    GRANT anon, authenticated, service_role TO ${local.db_user};
  SQL
}
