#!/bin/sh
# LocalStack "ready" hook for the aws reference profile (deploy/compose/aws.yml):
# the resources the AWS account would already have before the app starts.
#   Secrets Manager  usertasks/encryption-key (ENCRYPTION_KEY=secret://usertasks/encryption-key)
#   KMS              a symmetric key with alias/usertasks (KMS_PROVIDER=aws_kms)
# The S3 buckets are created by `node admin.cjs storage init` (the migrate
# container); the CloudWatch log group by the destination's auto_create.
set -eu
REGION="${AWS_DEFAULT_REGION:-eu-west-1}"
aws() { awslocal --region "$REGION" "$@"; }

aws secretsmanager create-secret --name usertasks/encryption-key --secret-string "${MOCK_ENCRYPTION_KEY:?MOCK_ENCRYPTION_KEY is not set}" >/dev/null 2>&1 \
  || aws secretsmanager put-secret-value --secret-id usertasks/encryption-key --secret-string "$MOCK_ENCRYPTION_KEY" >/dev/null

if ! aws kms describe-key --key-id alias/usertasks >/dev/null 2>&1; then
  KEY_ID=$(aws kms create-key --description "UserTasks KEK (local)" --query KeyMetadata.KeyId --output text)
  aws kms create-alias --alias-name alias/usertasks --target-key-id "$KEY_ID"
fi

echo "usertasks: LocalStack resources ready"
