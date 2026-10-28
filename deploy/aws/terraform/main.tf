# UserTasks reference deployment: the "AWS profile".
#
#   web        ECS on Fargate (node server.js, port 3000) behind an Application Load Balancer
#   migrate    ECS task definition: node admin.cjs db migrate (run before each rollout)
#   tick       EventBridge Scheduler → ECS RunTask `node worker.cjs --once` every minute
#              (or an API destination with CRON_SECRET, or an always-on worker service)
#   database   RDS for PostgreSQL 16, IAM database authentication, TLS enforced
#   cache      ElastiCache for Valkey, in-transit encryption, IAM-authenticated user
#   storage    Three S3 buckets (public access blocked, SSE)
#   secrets    Secrets Manager: <name>/encryption-key, <name>/cron-secret
#   kms        A customer managed key (alias/<name>) wrapping the data keys
#   email      SES identity
#   logs       CloudWatch Logs: container logs, and a group for log export
#   registry   ECR repository
#
# Nothing here uses Supabase or long-lived AWS keys: every AWS call is made
# with the task role (see docs/setup-aws.md).

data "aws_caller_identity" "this" {}
data "aws_partition" "this" {}

locals {
  account   = data.aws_caller_identity.this.account_id
  partition = data.aws_partition.this.partition

  database_name = "usertasks"
  db_user       = "usertasks_app"
  cache_user    = "${var.name}-app"
  buckets       = ["task-files", "logos", "brand-fonts"]
  bucket_prefix = "${var.name}-${local.account}-"

  app_url = var.app_url != "" ? trimsuffix(var.app_url, "/") : "${var.certificate_arn != "" ? "https" : "http"}://${aws_lb.web.dns_name}"
  image   = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"

  # verify-full against the RDS CA bundle shipped in the image (certs/rds-global-bundle.pem).
  db_url = "postgresql://${local.db_user}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${local.database_name}?sslmode=verify-full"

  env = {
    DEPLOYMENT_MODE       = "self_hosted"
    APP_URL               = local.app_url
    INSTANCE_ADMIN_EMAILS = var.instance_admin_emails
    AWS_REGION            = var.region

    DB_PROVIDER   = "postgres"
    DATABASE_URL  = local.db_url
    DATABASE_AUTH = "aws" # 15-minute RDS IAM tokens signed with the task role

    AUTH_PROVIDER      = var.auth_provider
    AUTH_SSO_PROVIDERS = var.auth_sso_providers

    REALTIME_PROVIDER = "sse"

    SCHEDULER_PROVIDER   = var.tick_mode == "worker" ? "worker" : "external"
    SCHEDULER_IN_PROCESS = "false"

    STORAGE_PROVIDER   = "s3"
    S3_REGION          = var.region
    STORAGE_BUCKET_MAP = jsonencode({ for b in local.buckets : b => aws_s3_bucket.buckets[b].bucket })

    EMAIL_PROVIDER = "ses"
    SES_REGION     = var.region
    EMAIL_FROM     = var.email_from

    SECRETS_PROVIDER           = "aws_secrets_manager"
    AWS_SECRETS_MANAGER_REGION = var.region
    # Resolved from Secrets Manager at startup (fails closed if unreadable).
    ENCRYPTION_KEY = "secret://${var.name}/encryption-key"

    KMS_PROVIDER   = "aws_kms"
    AWS_KMS_KEY_ID = aws_kms_alias.app.name

    CACHE_PROVIDER             = "redis"
    CACHE_REDIS_URL            = "rediss://${aws_elasticache_replication_group.cache.primary_endpoint_address}:6379"
    CACHE_REDIS_AUTH           = "aws_iam"
    CACHE_REDIS_USERNAME       = local.cache_user
    CACHE_REDIS_AWS_CACHE_NAME = aws_elasticache_replication_group.cache.replication_group_id

    LOG_EXPORT_ALLOW_INSTANCE_IDENTITY = tostring(var.allow_instance_identity_log_export)
  }

  environment = [for k, v in local.env : { name = k, value = v } if v != ""]
  secrets = [
    # CRON_SECRET for manual /api/cron/* calls (and the api_destination tick).
    { name = "CRON_SECRET", valueFrom = aws_secretsmanager_secret.cron.arn },
  ]
  log_config = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.containers.name
      awslogs-region        = var.region
      awslogs-stream-prefix = "app"
    }
  }
}

# ── Registry ────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "app" {
  name                 = var.name
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

# ── Keys and secrets ────────────────────────────────────────────────────────

resource "aws_kms_key" "app" {
  description         = "UserTasks key-encryption key (KMS_PROVIDER=aws_kms)"
  enable_key_rotation = true
}

resource "aws_kms_alias" "app" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.app.key_id
}

resource "random_id" "encryption_key" {
  byte_length = 32
}

resource "random_password" "cron_secret" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "encryption_key" {
  name        = "${var.name}/encryption-key"
  description = "UserTasks ENCRYPTION_KEY. Never change it once data is stored."
}

resource "aws_secretsmanager_secret_version" "encryption_key" {
  secret_id     = aws_secretsmanager_secret.encryption_key.id
  secret_string = random_id.encryption_key.hex
}

resource "aws_secretsmanager_secret" "cron" {
  name = "${var.name}/cron-secret"
}

resource "aws_secretsmanager_secret_version" "cron" {
  secret_id     = aws_secretsmanager_secret.cron.id
  secret_string = random_password.cron_secret.result
}

# ── Network security ────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "UserTasks load balancer"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "UserTasks ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "data" {
  name        = "${var.name}-data"
  description = "UserTasks RDS and ElastiCache (from the tasks only)"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
}

# ── Database: RDS for PostgreSQL with IAM database authentication ───────────

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.name}-pg${var.db_engine_version}"
  family = "postgres${var.db_engine_version}"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "main" {
  identifier                          = "${var.name}-pg"
  engine                              = "postgres"
  engine_version                      = var.db_engine_version
  instance_class                      = var.db_instance_class
  allocated_storage                   = var.db_allocated_storage
  storage_type                        = "gp3"
  storage_encrypted                   = true
  db_name                             = local.database_name
  username                            = "postgres"
  manage_master_user_password         = true # the master password lives in Secrets Manager (operator only)
  iam_database_authentication_enabled = true
  db_subnet_group_name                = aws_db_subnet_group.main.name
  parameter_group_name                = aws_db_parameter_group.main.name
  vpc_security_group_ids              = [aws_security_group.data.id]
  multi_az                            = var.db_multi_az
  backup_retention_period             = 7
  deletion_protection                 = true
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${var.name}-pg-final"
  auto_minor_version_upgrade          = true
  performance_insights_enabled        = true
}

# ── Cache: ElastiCache for Valkey with an IAM-authenticated user ────────────

resource "aws_elasticache_subnet_group" "cache" {
  name       = "${var.name}-cache"
  subnet_ids = var.private_subnet_ids
}

resource "random_password" "cache_default_user" {
  length  = 32
  special = false
}

# Every user group needs a "default" user; this one is switched off.
resource "aws_elasticache_user" "default" {
  user_id       = "${var.name}-default"
  user_name     = "default"
  engine        = "valkey"
  access_string = "off -@all"
  authentication_mode {
    type      = "password"
    passwords = [random_password.cache_default_user.result]
  }
}

# The app: IAM auth (user id = user name, as ElastiCache requires for IAM).
resource "aws_elasticache_user" "app" {
  user_id       = local.cache_user
  user_name     = local.cache_user
  engine        = "valkey"
  access_string = "on ~* +@all"
  authentication_mode {
    type = "iam"
  }
}

resource "aws_elasticache_user_group" "cache" {
  user_group_id = "${var.name}-users"
  engine        = "valkey"
  user_ids      = [aws_elasticache_user.default.user_id, aws_elasticache_user.app.user_id]
}

resource "aws_elasticache_replication_group" "cache" {
  replication_group_id       = "${var.name}-cache"
  description                = "UserTasks rate limits and cache invalidations"
  engine                     = "valkey"
  engine_version             = "8.0"
  node_type                  = var.cache_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.cache.name
  security_group_ids         = [aws_security_group.data.id]
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  user_group_ids             = [aws_elasticache_user_group.cache.user_group_id]
}

# ── Storage ─────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "buckets" {
  for_each = toset(local.buckets)
  bucket   = "${local.bucket_prefix}${each.key}"
}

resource "aws_s3_bucket_public_access_block" "buckets" {
  for_each                = aws_s3_bucket.buckets
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "buckets" {
  for_each = aws_s3_bucket.buckets
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# ── Email ───────────────────────────────────────────────────────────────────

resource "aws_sesv2_email_identity" "app" {
  email_identity = var.ses_identity
}

# ── Logs ────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "containers" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
}

# Target for an aws_cloudwatch_logs log destination (Settings → Log export:
# region, this group, auth instance_role).
resource "aws_cloudwatch_log_group" "events" {
  name              = "/usertasks/${var.name}/events"
  retention_in_days = var.log_retention_days
}

# ── IAM ─────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Pulls the image, writes container logs, injects CRON_SECRET.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.cron.arn] }]
  })
}

# What the app itself does with AWS (the credential chain finds it on ECS).
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task" {
  name = "usertasks"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RdsIamAuth"
        Effect   = "Allow"
        Action   = ["rds-db:connect"]
        Resource = ["arn:${local.partition}:rds-db:${var.region}:${local.account}:dbuser:${aws_db_instance.main.resource_id}/${local.db_user}"]
      },
      {
        Sid    = "ElastiCacheIamAuth"
        Effect = "Allow"
        Action = ["elasticache:Connect"]
        Resource = [
          aws_elasticache_replication_group.cache.arn,
          aws_elasticache_user.app.arn,
        ]
      },
      {
        Sid      = "Buckets"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [for b in aws_s3_bucket.buckets : b.arn]
      },
      {
        Sid      = "Objects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [for b in aws_s3_bucket.buckets : "${b.arn}/*"]
      },
      {
        Sid      = "Email"
        Effect   = "Allow"
        Action   = ["ses:SendEmail"]
        Resource = ["*"]
      },
      {
        Sid      = "Secrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = ["arn:${local.partition}:secretsmanager:${var.region}:${local.account}:secret:${var.name}/*"]
      },
      {
        Sid      = "Kek"
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:Decrypt"]
        Resource = [aws_kms_key.app.arn]
      },
      {
        Sid      = "LogExport"
        Effect   = "Allow"
        Action   = ["logs:PutLogEvents", "logs:CreateLogStream"]
        Resource = ["${aws_cloudwatch_log_group.events.arn}:*"]
      },
    ]
  })
}

# ── Load balancer ───────────────────────────────────────────────────────────

resource "aws_lb" "web" {
  name               = "${var.name}-web"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
  # SSE streams send a heartbeat every 15 s; the default 60 s idle timeout is fine.
  idle_timeout = 60
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/api/config/public"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = var.certificate_arn != "" ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
  dynamic "default_action" {
    for_each = var.certificate_arn == "" ? [1] : []
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }
}

# ── ECS ─────────────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "web" {
  count                    = var.deploy_apps ? 1 : 0
  family                   = "${var.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name             = "web"
    image            = local.image
    essential        = true
    command          = ["node", "server.js"]
    portMappings     = [{ containerPort = 3000, protocol = "tcp" }]
    environment      = local.environment
    secrets          = local.secrets
    logConfiguration = local.log_config
  }])
}

# One-off tasks: migrations (and, with overridden commands, bootstrap / doctor).
resource "aws_ecs_task_definition" "admin" {
  count                    = var.deploy_apps ? 1 : 0
  family                   = "${var.name}-admin"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name             = "admin"
    image            = local.image
    essential        = true
    command          = ["node", "admin.cjs", "db", "migrate"]
    environment      = local.environment
    secrets          = local.secrets
    logConfiguration = local.log_config
  }])
}

# The scheduler tick: one minute's jobs, then exit (tick_mode scheduler_ecs),
# or the long-running worker (tick_mode worker).
resource "aws_ecs_task_definition" "worker" {
  count                    = var.deploy_apps && var.tick_mode != "api_destination" ? 1 : 0
  family                   = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name             = "worker"
    image            = local.image
    essential        = true
    command          = var.tick_mode == "worker" ? ["node", "worker.cjs"] : ["node", "worker.cjs", "--once"]
    environment      = local.environment
    secrets          = local.secrets
    logConfiguration = local.log_config
  }])
}

resource "aws_ecs_service" "web" {
  count                             = var.deploy_apps ? 1 : 0
  name                              = "${var.name}-web"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.web[0].arn
  desired_count                     = var.web_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.tasks.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "worker" {
  count           = var.deploy_apps && var.tick_mode == "worker" ? 1 : 0
  name            = "${var.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.tasks.id]
  }
}

# ── Tick: EventBridge Scheduler → ECS RunTask (IAM, no endpoint) ────────────

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = var.deploy_apps && var.tick_mode == "scheduler_ecs" ? 1 : 0
  name               = "${var.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  count = var.deploy_apps && var.tick_mode == "scheduler_ecs" ? 1 : 0
  name  = "run-tick"
  role  = aws_iam_role.scheduler[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecs:RunTask"], Resource = [aws_ecs_task_definition.worker[0].arn_without_revision, "${aws_ecs_task_definition.worker[0].arn_without_revision}:*"] },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = [aws_iam_role.execution.arn, aws_iam_role.task.arn] },
    ]
  })
}

resource "aws_scheduler_schedule" "tick" {
  count                        = var.deploy_apps && var.tick_mode == "scheduler_ecs" ? 1 : 0
  name                         = "${var.name}-tick"
  schedule_expression          = "rate(1 minute)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler[0].arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.worker[0].arn_without_revision
      launch_type         = "FARGATE"
      task_count          = 1
      network_configuration {
        subnets          = var.private_subnet_ids
        security_groups  = [aws_security_group.tasks.id]
        assign_public_ip = false
      }
    }

    retry_policy {
      maximum_retry_attempts       = 0 # a missed minute catches up on the next tick
      maximum_event_age_in_seconds = 60
    }
  }
}

# ── Tick: EventBridge rule → API destination with CRON_SECRET ───────────────

resource "aws_cloudwatch_event_connection" "tick" {
  count              = var.deploy_apps && var.tick_mode == "api_destination" ? 1 : 0
  name               = "${var.name}-tick"
  authorization_type = "API_KEY"
  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${random_password.cron_secret.result}"
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "tick" {
  count                            = var.deploy_apps && var.tick_mode == "api_destination" ? 1 : 0
  name                             = "${var.name}-tick"
  invocation_endpoint              = "${local.app_url}/api/cron/tick"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.tick[0].arn
}

resource "aws_cloudwatch_event_rule" "tick" {
  count               = var.deploy_apps && var.tick_mode == "api_destination" ? 1 : 0
  name                = "${var.name}-tick"
  schedule_expression = "rate(1 minute)"
}

data "aws_iam_policy_document" "events_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "events" {
  count              = var.deploy_apps && var.tick_mode == "api_destination" ? 1 : 0
  name               = "${var.name}-tick-events"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
}

resource "aws_iam_role_policy" "events" {
  count = var.deploy_apps && var.tick_mode == "api_destination" ? 1 : 0
  name  = "invoke-tick"
  role  = aws_iam_role.events[0].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["events:InvokeApiDestination"], Resource = [aws_cloudwatch_event_api_destination.tick[0].arn] }]
  })
}

resource "aws_cloudwatch_event_target" "tick" {
  count    = var.deploy_apps && var.tick_mode == "api_destination" ? 1 : 0
  rule     = aws_cloudwatch_event_rule.tick[0].name
  arn      = aws_cloudwatch_event_api_destination.tick[0].arn
  role_arn = aws_iam_role.events[0].arn
  input    = "{}"
  retry_policy {
    maximum_retry_attempts       = 0
    maximum_event_age_in_seconds = 60
  }
}
