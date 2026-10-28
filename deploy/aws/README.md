# UserTasks on AWS (reference deployment)

Terraform (AWS provider 5.x) in `terraform/`. Nothing here depends on
Supabase, and the app holds no long-lived AWS keys: every AWS call uses the
ECS task role. See [AWS setup](../../docs/setup-aws.md) for the walkthrough
and [docs/infrastructure.md](../../docs/infrastructure.md) for every setting.

`rds-global-bundle.pem` is the Amazon RDS CA bundle
(<https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem>). The
Docker image ships it as `certs/rds-global-bundle.pem`, and
`DATABASE_AUTH=aws` verifies the database with it. Refresh the file when AWS
publishes new CAs.

## What gets created

| Resource | Purpose |
|---|---|
| ECR repository `<name>` | Image |
| ECS cluster, Fargate service `<name>-web` | `node server.js` on 3000 behind an ALB (health check `/api/config/public`), `SCHEDULER_IN_PROCESS=false` |
| Task definition `<name>-admin` | `node admin.cjs db migrate` (override the command for `bootstrap` / `doctor`) |
| Task definition `<name>-worker` + EventBridge Scheduler `<name>-tick` | `rate(1 minute)` → ECS RunTask `node worker.cjs --once` (`tick_mode = "scheduler_ecs"`, default). IAM only: no tick endpoint call, no shared secret |
| EventBridge rule + API destination + connection | `tick_mode = "api_destination"`: `POST <APP_URL>/api/cron/tick` with `Authorization: Bearer <CRON_SECRET>` |
| Fargate service `<name>-worker` | `tick_mode = "worker"`: an always-on `node worker.cjs` |
| Application Load Balancer | HTTPS with `certificate_arn` (HTTP redirects), else HTTP only |
| RDS for PostgreSQL 16 `<name>-pg` | IAM database authentication, `rds.force_ssl=1`, encrypted, master password managed in Secrets Manager, backups, deletion protection |
| ElastiCache for Valkey 8 `<name>-cache` | Two nodes, in-transit and at-rest encryption, user group with an IAM-authenticated user `<name>-app` (the `default` user is off) |
| S3 buckets `<name>-<account>-task-files`, `-logos`, `-brand-fonts` | Public access blocked, bucket-owner-enforced |
| KMS key `alias/<name>` | Key-encryption key for stored secrets (`KMS_PROVIDER=aws_kms`), rotation on |
| Secrets Manager `<name>/encryption-key`, `<name>/cron-secret` | App secrets |
| SES identity | `ses_identity` (domain: publish the DKIM CNAMEs from `ses_dkim_tokens`) |
| CloudWatch log groups `/ecs/<name>`, `/usertasks/<name>/events` | Container logs; the target for a CloudWatch Logs log destination |
| IAM roles `<name>-execution`, `<name>-task`, `<name>-scheduler` | Image pull / logs / `CRON_SECRET`; the app's permissions (below); RunTask for the tick |

The task role may: `rds-db:connect` as `usertasks_app`, `elasticache:Connect`
to the cache as `<name>-app`, read and write the three buckets,
`ses:SendEmail`, read `<name>/*` secrets, `kms:Encrypt` / `kms:Decrypt` on the
key, and `logs:PutLogEvents` / `logs:CreateLogStream` on the export group.

## Environment → resource

| Variable | Value |
|---|---|
| `DB_PROVIDER` / `DATABASE_URL` / `DATABASE_AUTH` | `postgres` / `postgresql://usertasks_app@<rds endpoint>:5432/usertasks?sslmode=verify-full` / `aws` (15-minute IAM tokens signed with the task role) |
| `CACHE_PROVIDER` / `CACHE_REDIS_URL` / `CACHE_REDIS_AUTH` | `redis` / `rediss://<primary endpoint>:6379` / `aws_iam` with `CACHE_REDIS_USERNAME=<name>-app`, `CACHE_REDIS_AWS_CACHE_NAME=<name>-cache` |
| `STORAGE_PROVIDER` / `STORAGE_BUCKET_MAP` | `s3` / the three buckets |
| `EMAIL_PROVIDER` / `SES_REGION` | `ses` / the region |
| `SECRETS_PROVIDER` / `ENCRYPTION_KEY` | `aws_secrets_manager` / `secret://<name>/encryption-key` |
| `KMS_PROVIDER` / `AWS_KMS_KEY_ID` | `aws_kms` / `alias/<name>` |
| `SCHEDULER_PROVIDER` | `external` (`worker` with `tick_mode = "worker"`) |
| `CRON_SECRET` | ECS secret from `<name>/cron-secret` |
| `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY` | `allow_instance_identity_log_export` (default true: single-organisation installs) |
| `REALTIME_PROVIDER` / `AUTH_PROVIDER` | `sse` / `builtin` (add Cognito with the `cognito` preset in `auth_sso_providers`) |

## Deploy

```bash
cd deploy/aws/terraform
cp terraform.tfvars.example terraform.tfvars        # edit: VPC, subnets, certificate, SES identity
terraform init
terraform apply -var deploy_apps=false              # registry, RDS, ElastiCache, buckets, secrets, key, ALB
IMAGE=$(terraform output -raw image)
aws ecr get-login-password | docker login --username AWS --password-stdin ${IMAGE%%/*}
docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_APP_URL=https://tasks.example.com -t $IMAGE .   # from the repository root
docker push $IMAGE
```

Run the one-time grant (next section), then `terraform apply` to create the
services and the tick.

## After the first deploy

1. **One-time database grant.** Connect to the instance as `postgres`
   (password: `aws secretsmanager get-secret-value --secret-id $(terraform output -raw database_master_secret_arn)`),
   for example from a bastion or an ECS Exec session, and run
   `terraform output -raw db_grant_sql`. It creates the IAM user
   `usertasks_app` (`rds_iam`), lets it own the database and the `public`
   schema, and pre-creates the `anon` / `authenticated` / `service_role` /
   `authenticator` roles the migrations expect.
2. **Migrate** before every rollout:

   ```bash
   aws ecs run-task --cluster usertasks --launch-type FARGATE --task-definition usertasks-admin \
     --network-configuration "awsvpcConfiguration={subnets=[<private subnets>],securityGroups=[<tasks sg>]}"
   ```

3. **First tenant and owner:** the same with
   `--overrides '{"containerOverrides":[{"name":"admin","command":["node","admin.cjs","bootstrap","--email","you@example.com","--password","…","--org","Acme"]}]}'`.
4. **Check:** the same with `["node","admin.cjs","doctor"]`. The database
   check reports `RDS IAM token for usertasks_app@… (TLS verified with
   rds-global-bundle.pem); user granted rds_iam`.
5. **Log export (optional):** in Settings → Log export add an Amazon
   CloudWatch Logs destination: the region, log group
   `terraform output -raw log_export_group`, authentication `instance_role`.

## Notes

- **RDS Proxy.** Put `DATABASE_URL` on the proxy endpoint (enable IAM auth
  and TLS on the proxy; the token is signed for the proxy's host name). Keep
  `MIGRATION_DATABASE_URL`, `REALTIME_DATABASE_URL` and
  `SCHEDULER_DATABASE_URL` on the instance endpoint: migrations, `LISTEN` and
  the leader lock need a session. All of them can use `DATABASE_AUTH=aws`.
- **Network.** Tasks need RDS, ElastiCache and the AWS APIs (ECR, logs, S3,
  SES, Secrets Manager, KMS, STS for the credential chain). Without a NAT
  gateway, add VPC endpoints for them (interface endpoints, and a gateway
  endpoint for S3).
- **The tick.** `scheduler_ecs` starts a small Fargate task every minute;
  a run that overlaps the next one is safe (advisory-lock leader, leased
  jobs). For lower cost at very low traffic use `worker`; on App Runner (no
  ECS tasks) use `api_destination`, or an API destination with a Cognito
  OAuth client-credentials connection (`SCHEDULER_COGNITO_*`, see
  docs/infrastructure.md#scheduler).
- **Validation.** Checked with `terraform validate` (Terraform 1.9, AWS
  provider 5.x); not applied to a live account. The ElastiCache IAM user and
  the grant SQL follow AWS's documentation.
- **Secrets in state.** Terraform generates `ENCRYPTION_KEY` and
  `CRON_SECRET`, so they are in the state file: use a remote backend with
  restricted access. Never change `<name>/encryption-key` once data is stored.
- **Cost (rough, list prices, eu-west-1).** RDS `db.t4g.medium` single-AZ +
  20 GB ≈ US$60/month (Multi-AZ doubles it); two web tasks (1 vCPU / 2 GB) ≈
  US$70/month; ElastiCache two `cache.t4g.small` ≈ US$50/month; the
  per-minute tick task ≈ US$10–15/month; ALB ≈ US$20/month plus NAT or VPC
  endpoints.
