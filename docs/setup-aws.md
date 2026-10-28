# AWS setup

This is the reference deployment on AWS. The template is in
`deploy/aws/terraform/`, and `deploy/aws/README.md` has the full commands.
The [AWS reference profile](deployment-profiles.md#aws-aws) runs the same
provider combination locally against LocalStack. Every AWS call the app
makes uses the ECS task role; there are no long-lived AWS keys.

| Area | AWS service | Settings |
|---|---|---|
| Hosting | ECS on Fargate behind an Application Load Balancer, with a migrate task definition | `SCHEDULER_IN_PROCESS=false` on the web tasks |
| Database | RDS for PostgreSQL 16 (or Aurora, or through RDS Proxy) with IAM database authentication | `DB_PROVIDER=postgres`, `DATABASE_AUTH=aws`, `DATABASE_URL=postgresql://usertasks_app@<endpoint>:5432/usertasks?sslmode=verify-full`; the image's RDS CA bundle verifies the server (`DATABASE_SSL_CA_FILE` overrides it) |
| Auth | Built-in, plus Amazon Cognito over OIDC | `AUTH_SSO_PROVIDERS` with `"preset":"cognito"`, `userPoolId`, `domain`; `cognito:groups` → `roleMapping` |
| Storage | Amazon S3 (public access blocked) | `STORAGE_PROVIDER=s3`, `S3_REGION`, `STORAGE_BUCKET_MAP` |
| Realtime | Built-in SSE | `REALTIME_PROVIDER=sse` |
| Scheduler | EventBridge Scheduler running `node worker.cjs --once` as an ECS task every minute (IAM only) | `SCHEDULER_PROVIDER=external`; or an API destination with `CRON_SECRET`, or with Cognito client-credentials tokens (`SCHEDULER_COGNITO_*`) |
| Email | Amazon SES (`ses:SendEmail`) | `EMAIL_PROVIDER=ses`, `SES_REGION`, `EMAIL_FROM` |
| Secrets | AWS Secrets Manager (`secretsmanager:GetSecretValue`) | `SECRETS_PROVIDER=aws_secrets_manager`, `ENCRYPTION_KEY=secret://<name>/encryption-key` |
| KMS | A customer managed key wrapping the data keys (`kms:Encrypt`, `kms:Decrypt`) | `KMS_PROVIDER=aws_kms`, `AWS_KMS_KEY_ID=alias/<name>`; then `usertasks-admin kms rotate` and `kms rewrap` |
| Cache | ElastiCache for Valkey with in-transit encryption and an IAM-authenticated user (`elasticache:Connect`) | `CACHE_PROVIDER=redis`, `CACHE_REDIS_URL=rediss://<primary endpoint>:6379`, `CACHE_REDIS_AUTH=aws_iam`, `CACHE_REDIS_USERNAME`, `CACHE_REDIS_AWS_CACHE_NAME` |
| Log export (per workspace) | CloudWatch Logs destinations (`logs:PutLogEvents`) | Settings → Log Export; an IAM access key per destination, or `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true` to let destinations use the task role (single-tenant only) |

## Steps

1. **Create the infrastructure:** `terraform apply` with
   `deploy_apps=false`. That creates ECR, RDS, ElastiCache, the buckets, the
   key, the secrets, the SES identity and the load balancer. Publish the SES
   DKIM records (`ses_dkim_tokens`) and, for production mail, leave the SES
   sandbox.
2. **Push the image** to ECR.
3. **Create the IAM database user.** Run the `db_grant_sql` output once as
   `postgres` (master password in Secrets Manager). It grants `rds_iam`,
   makes the user own the database and creates the API roles the
   migrations need.
4. **Create the services:** `terraform apply` with `deploy_apps=true`. Then
   run the admin task definition (`node admin.cjs db migrate`).
5. **Create the first workspace.** Run the admin task with the command
   overridden to `node admin.cjs bootstrap --email … --org …`.
6. **Check the install:** the same with `node admin.cjs doctor`. The
   database line shows the IAM token, the TLS verification and the
   `rds_iam` grant; the cache line shows `(aws_iam auth)`.

## IAM database authentication

`DATABASE_AUTH=aws` signs a token for the URL's host, port and user with
`@aws-sdk/rds-signer` and the instance's credentials (ECS task role, EC2
instance profile, EKS IRSA / Pod Identity, `AWS_*` variables). Tokens live
15 minutes; each is reused for 10 and replaced before it expires, per
endpoint and user, and open connections are unaffected. The region comes
from `DATABASE_AWS_REGION`, else the RDS host name, else `AWS_REGION`.
TLS is on (unless the URL says `sslmode=disable`) and verified against
`DATABASE_SSL_CA_FILE`, else the RDS CA bundle in the image. The same
applies to `MIGRATION_DATABASE_URL`, `REALTIME_DATABASE_URL`,
`SCHEDULER_DATABASE_URL` and `usertasks-admin db migrate`. With **RDS
Proxy**, enable IAM authentication on the proxy and point `DATABASE_URL` at
it; keep the session URLs on the instance endpoint.

## ElastiCache IAM authentication

`CACHE_REDIS_AUTH=aws_iam` sends a SigV4-presigned `connect` request for
`CACHE_REDIS_AWS_CACHE_NAME` (replication group, serverless cache with
`CACHE_REDIS_AWS_SERVERLESS=true`, or MemoryDB cluster with
`CACHE_REDIS_AWS_SERVICE=memorydb`) as the AUTH password of
`CACHE_REDIS_USERNAME` (an IAM-enabled user whose id equals its name). The
token is valid 15 minutes; the app re-AUTHs the open connection a minute
before it lapses, which also extends ElastiCache's 12-hour limit for IAM
connections. TLS is on unless `CACHE_REDIS_TLS=false`.

## Not emulated locally

The AWS reference profile can't check RDS IAM tokens or ElastiCache IAM
tokens (no emulator verifies them); both are covered by tests with a fake
signer against PostgreSQL and Valkey.

## Moving an existing Supabase install

See [Switching providers](switching-providers.md#moving-a-whole-install-off-supabase).
The RDS master user (`rds_superuser`) can run the database copy; switch the
app to `DATABASE_AUTH=aws` afterwards.
