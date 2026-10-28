# Release notes: first-class AWS

Every infrastructure area now has a native AWS option that uses IAM instead
of long-lived keys or shared passwords, with a Terraform reference profile
and an `aws` Docker Compose profile against LocalStack. Nothing changes
unless you opt in: passwords, AUTH tokens and `CRON_SECRET` keep working,
and the Supabase defaults are untouched.

## Added

- **RDS / Aurora / RDS Proxy IAM database auth: `DATABASE_AUTH=aws`.**
  15-minute tokens from `@aws-sdk/rds-signer` (optional dependency, loaded
  on first use), signed with the instance's credentials for the URL's host,
  port and user, reused for 10 minutes and renewed before they expire. TLS
  is on and verified against `DATABASE_SSL_CA_FILE` or the RDS CA bundle now
  shipped in the image (`certs/rds-global-bundle.pem`). Applies to every
  connection the app, the worker and `usertasks-admin db migrate` open.
  `DATABASE_AWS_REGION` overrides the region read from the host name.
- **`DATABASE_SSL_CA_FILE`** (any mode): a CA bundle for the database's
  server certificate.
- **ElastiCache / MemoryDB IAM auth: `CACHE_REDIS_AUTH=aws_iam`.**
  SigV4-presigned connect tokens (`CACHE_REDIS_AWS_CACHE_NAME`,
  `CACHE_REDIS_AWS_REGION`, `CACHE_REDIS_AWS_SERVICE`,
  `CACHE_REDIS_AWS_SERVERLESS`), re-sent on the open connection before they
  lapse; TLS by default.
- **Amazon CloudWatch Logs log destination (`aws_cloudwatch_logs`).**
  `PutLogEvents` within CloudWatch's limits (1 MB with 26 bytes per event,
  10,000 events, 24 hours per batch), time-ordered per batch, throttling
  retried, optional log group / stream creation. Credentials: an IAM access
  key stored encrypted (either value may be a
  `secret://tenants/<workspace id>/…` reference), or the instance's role with
  `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true`. `LOG_EXPORT_AWS_ENDPOINT_URL`
  for VPC endpoints and LocalStack. Migration `20261111000000` widens the
  destination type check.
- **Amazon Cognito OIDC preset (`"preset": "cognito"`):** issuer from
  `userPoolId`, hosted UI / managed login `domain`, `cognito:groups` as the
  default groups claim for `roleMapping`.
- **Cognito-verified tick:** `SCHEDULER_COGNITO_USER_POOL_ID`,
  `SCHEDULER_COGNITO_ALLOWED_CLIENTS` and `SCHEDULER_COGNITO_SCOPE` accept
  access tokens from an EventBridge API destination whose connection uses
  OAuth client credentials. `node worker.cjs --once` no longer warns under
  `SCHEDULER_PROVIDER=external` (EventBridge Scheduler → ECS RunTask).
- **`deploy/aws/terraform`:** ECS on Fargate + ALB, RDS PostgreSQL 16 with
  IAM auth, ElastiCache Valkey with an IAM user, S3, SES, Secrets Manager, a
  KMS key, CloudWatch log groups, ECR, and an EventBridge Scheduler tick
  (or API destination, or worker service). Checked with `terraform
  validate`; not applied to a live account.
- **`npm run stack -- up|smoke --profile aws`:** LocalStack (S3, Secrets
  Manager, KMS, CloudWatch Logs) with task-role credentials, SES v2 and
  Cognito stand-ins; a release gate like the other profiles. The azure and
  gcp profiles now also smoke-test Azure Monitor and Cloud Logging log
  export against stand-ins.
- **Catalogue:** an `aws` flag on every provider, `usertasks-admin providers
  list --aws`, an AWS badge on Settings → Infrastructure, and a doctor
  `auth` check for token database auth (the `rds_iam` grant and TLS).
- **Docs:** [AWS setup](../setup-aws.md), the AWS topology now native, and
  the services pages.

## Notes

- The new optional packages are `@aws-sdk/rds-signer` and
  `@aws-sdk/credential-providers` (dropped with `INCLUDE_PROVIDER_SDKS=false`).
- RDS and ElastiCache IAM tokens are not verifiable locally; they are tested
  with a fake signer against PostgreSQL and Valkey.
- Tokens, keys and signatures are never logged or put in error messages.
