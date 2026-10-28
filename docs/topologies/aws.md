# Topology: single cloud on AWS

Every area runs in one AWS account and region. The app runs on ECS (Fargate)
or App Runner, the database is RDS or Aurora PostgreSQL, and files, email,
secrets, keys and the cache use AWS services. Realtime and scheduling are
built into the app.

The reference deployment is `deploy/aws/terraform` (see
[AWS setup](../setup-aws.md)), and the `aws` [reference profile](../deployment-profiles.md#aws-aws)
runs the same combination locally against LocalStack. The table says which
pieces use AWS's own APIs and IAM ("native") and which use a generic
protocol with AWS as the server ("compatible"). Every native piece uses the
task role: no long-lived AWS keys.

<!-- ::topology aws -->

## What runs where

| Area | AWS service | Provider id | Native or compatible |
|---|---|---|---|
| Hosting | ECS on Fargate: a web service, a worker service, a migrate task. Or App Runner (web only) | — | The Docker image: `node server.js`, `node worker.cjs`, `node admin.cjs` |
| Database | RDS for PostgreSQL or Aurora PostgreSQL 15+ (optionally through RDS Proxy) | `postgres` | Native: IAM database authentication (`DATABASE_AUTH=aws`), 15-minute tokens from the task role, TLS verified with the RDS CA bundle in the image |
| Auth | Built-in passwords, with Amazon Cognito (or any OIDC IdP) for SSO | `builtin` or `oidc` | Native: the `cognito` OIDC preset (user pool issuer, hosted UI domain, `cognito:groups` → roles) |
| Storage | Amazon S3 | `s3` | Native: task role, instance profile or IRSA. `STORAGE_PUBLIC_BASE_URL` can serve public files from S3 or CloudFront |
| Realtime | Built-in Server-Sent Events | `sse` | Built in: LISTEN/NOTIFY on the database |
| Scheduler | EventBridge Scheduler running `node worker.cjs --once` as an ECS task, the built-in worker, or an EventBridge API destination (App Runner) | `external` or `worker` | Native: Scheduler → ECS RunTask is IAM only; API destinations send Cognito client-credentials tokens (verified) or `CRON_SECRET` |
| Email | Amazon SES | `ses` | Native: `ses:SendEmail` on the task role |
| Secrets | AWS Secrets Manager | `aws_secrets_manager` | Native: `secretsmanager:GetSecretValue` |
| KMS | AWS KMS | `aws_kms` | Native: `kms:Encrypt` / `kms:Decrypt`; the data-key id is sent as encryption context, so every unwrap shows in CloudTrail |
| Cache | ElastiCache for Valkey or Redis OSS, or MemoryDB | `redis` | Native: IAM auth (`CACHE_REDIS_AUTH=aws_iam`, presigned tokens re-sent every 14 minutes) over TLS; or an AUTH token. Cluster mode must be disabled |
| Log export | Amazon CloudWatch Logs | `aws_cloudwatch_logs` destination | Native: `PutLogEvents` with SigV4; an IAM key per destination, or the task role with `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true` |
| Directory sync | SCIM from your IdP, or LDAP against AWS Managed Microsoft AD | per workspace | Compatible: LDAPS |

### Hosting notes

- **Image.** The S3, SES, Secrets Manager and KMS SDKs are in the image by
  default; the Snowflake, Oracle and MongoDB drivers need
  `--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true`
  ([Optional drivers](../optional-drivers.md)).
- **ECS on Fargate** (recommended). Run the web service behind an
  Application Load Balancer, with health check `/api/config/public`. Run a
  one-task worker service (`node worker.cjs`), and set
  `SCHEDULER_IN_PROCESS=false` on the web tasks. Before each rollout, run
  `node admin.cjs db migrate` as a one-off task. The SSE stream sends a
  heartbeat every 15 seconds, so the ALB's default idle timeout is fine.
- **The tick on ECS.** EventBridge Scheduler (`rate(1 minute)`) runs the
  image as a one-off Fargate task, `node worker.cjs --once`. Only IAM is
  involved (`ecs:RunTask`, `iam:PassRole`); set `SCHEDULER_PROVIDER=external`.
  Or run a one-task worker service (`node worker.cjs`, `SCHEDULER_PROVIDER=worker`).
- **App Runner** pauses CPU between requests, so the in-process worker
  can't run there. Drive the tick from outside: an EventBridge scheduled
  rule (`rate(1 minute)`) with an API destination to
  `POST <APP_URL>/api/cron/tick`, whose connection either uses OAuth client
  credentials against a Cognito app client (`SCHEDULER_COGNITO_USER_POOL_ID`,
  `SCHEDULER_COGNITO_ALLOWED_CLIENTS`) or sends
  `Authorization: Bearer <CRON_SECRET>`. Set `SCHEDULER_PROVIDER=external`.
- **RDS Proxy** works in transaction mode for the app's queries, with IAM
  auth enabled on the proxy. Keep `MIGRATION_DATABASE_URL`,
  `REALTIME_DATABASE_URL` and `SCHEDULER_DATABASE_URL` on the instance
  endpoint, because migrations, `LISTEN` and the worker's leader lock need a
  session. `DATABASE_AUTH=aws` signs a token per endpoint.

## Configuration

```bash
DB_PROVIDER=postgres
DATABASE_URL=postgresql://usertasks_app@acme-ut.cluster-xyz.eu-west-1.rds.amazonaws.com:5432/usertasks?sslmode=verify-full
DATABASE_AUTH=aws                    # IAM token from the task role; the user is granted rds_iam
AUTH_PROVIDER=builtin
AUTH_SSO_PROVIDERS=[{"id":"cognito","type":"oidc","preset":"cognito","name":"Company login","userPoolId":"eu-west-1_AbCdEf","domain":"acme.auth.eu-west-1.amazoncognito.com","clientId":"…","clientSecret":"secret://cognito-client-secret","roleMapping":{"admins":"admin"}}]
REALTIME_PROVIDER=sse
SCHEDULER_PROVIDER=external          # EventBridge Scheduler → `node worker.cjs --once`; or worker
STORAGE_PROVIDER=s3
S3_REGION=eu-west-1
STORAGE_BUCKET_PREFIX=acme-ut-       # buckets acme-ut-task-files, acme-ut-logos, acme-ut-brand-fonts
EMAIL_PROVIDER=ses
SES_REGION=eu-west-1
EMAIL_FROM="UserTasks <tasks@corp.example>"
SECRETS_PROVIDER=aws_secrets_manager
AWS_SECRETS_MANAGER_REGION=eu-west-1
ENCRYPTION_KEY=secret://usertasks/encryption-key
KMS_PROVIDER=aws_kms
AWS_KMS_KEY_ID=alias/usertasks
CACHE_PROVIDER=redis
CACHE_REDIS_URL=rediss://master.acme-ut.xyz.euw1.cache.amazonaws.com:6379
CACHE_REDIS_AUTH=aws_iam
CACHE_REDIS_USERNAME=usertasks-app
CACHE_REDIS_AWS_CACHE_NAME=acme-ut
LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true   # single-organisation installs: CloudWatch destinations may use the task role
APP_URL=https://tasks.corp.example
```

The task role needs `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and
`s3:ListBucket` on the buckets, `ses:SendEmail`,
`secretsmanager:GetSecretValue` on the `usertasks/*` secrets,
`kms:Encrypt` / `kms:Decrypt` on the key, `rds-db:connect` on the database
user, `elasticache:Connect` on the cache and its user, and
`logs:PutLogEvents` / `logs:CreateLogStream` on the export log group.
`deploy/aws/terraform` creates exactly that.

## Getting here from Supabase

Move the hosting first: run the image on ECS with the same Supabase
environment. Then switch the areas that don't touch the database. The
install is now [hybrid](hybrid.md), and each step can be checked on its
own. The database goes last.

```bash
# 1. Areas that don't depend on the database
usertasks-admin switch storage --to s3 --set region=eu-west-1 --set bucket_prefix=acme-ut- --yes
usertasks-admin switch email   --to ses --set ses_region=eu-west-1 --set from='UserTasks <tasks@corp.example>' --test-to you@corp.example --yes
usertasks-admin switch secrets --to aws_secrets_manager --set aws_region=eu-west-1 --yes
usertasks-admin switch kms     --to aws_kms --set aws_kms_key_id=alias/usertasks --yes && usertasks-admin kms rewrap --yes
usertasks-admin switch cache   --to redis --set redis_url=rediss://master.acme-ut.xyz.euw1.cache.amazonaws.com:6379 \
  --set redis_auth=aws_iam --set redis_username=usertasks-app --set redis_aws_cache_name=acme-ut --yes

# 2. The Supabase-only areas (built-in auth on the Supabase database needs SUPABASE_JWT_SECRET)
usertasks-admin switch auth      --to builtin --yes          # everyone signs in again
usertasks-admin switch realtime  --to sse --yes
usertasks-admin switch scheduler --to worker --yes           # then start the worker service

# 3. Stop writes (scale the web and worker services to 0), then copy the database
usertasks-admin switch database --to postgres \
  --target-url 'postgresql://usertasks:…@acme-ut.cluster-xyz.eu-west-1.rds.amazonaws.com:5432/usertasks?sslmode=require' --yes
```

Restart with the printed `DB_PROVIDER=postgres` and `DATABASE_URL`, and
remove every `SUPABASE_*` variable. To move to IAM database auth, create the
`rds_iam` user (`db_grant_sql` in `deploy/aws`), point `DATABASE_URL` at it
without a password and set `DATABASE_AUTH=aws`. Keep the same `ENCRYPTION_KEY` (or the
same KMS key). Run `usertasks-admin doctor`. The RDS master user
(`rds_superuser`) can run the copy. See
[Switching providers](../switching-providers.md#moving-a-whole-install-off-supabase).

## Trade-offs

- **Cost:** RDS or Aurora is usually the biggest item, then Fargate tasks
  (web, worker), ElastiCache and NAT gateway data processing if the tasks
  reach AWS APIs through NAT. VPC endpoints for S3, Secrets Manager, KMS and
  SES remove that traffic from the NAT path.
- **Operations:** one IAM model, one console, CloudTrail for every key and
  secret access. You own database sizing, upgrades and failover (Multi-AZ).
- **Latency:** the app and the database share a region and VPC, so
  database round trips are local.
- **Compliance:** everything is under one AWS account's controls, logging
  and region. That is the simplest story for an AWS-only audit.

## Data residency

One region holds everything: the database, buckets, SES identity, secrets
and KMS key. Make sure S3 replication, Aurora global databases and
cross-region backups are explicit choices, not defaults.

## Failure domains

One cloud, one region. Use a Multi-AZ database and at least two web tasks
across Availability Zones. With more than one task, use a shared cache
(`redis` or `postgres`). Worker leader election moves the tick to another
task within a minute if one dies.

## Not wired yet

- An AWS-hosted SAML or OIDC IdP other than Cognito uses the generic
  presets (IAM Identity Center applications work as generic SAML).
- Kinesis Data Firehose, SNS and SQS log destinations (use CloudWatch Logs
  with a subscription filter to fan out).
