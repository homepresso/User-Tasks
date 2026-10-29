/**
 * The optional packages (package.json optionalDependencies): database drivers,
 * storage / email / secrets / KMS provider SDKs, the SAML library and tesseract.js (OCR). Each is
 * loaded only by the feature that needs it. When one is not installed at build
 * time, next.config.ts aliases it to the matching missing-*.ts stub in this
 * folder, so the feature fails with an actionable message (see
 * {@link optionalPackageInstallHint}) instead of breaking the build.
 *
 * Documented at /docs/self-hosting/optional-drivers (docs/optional-drivers.md).
 * __tests__/optional-drivers.test.ts keeps this list, package.json, the stubs
 * and the Dockerfile in step.
 */

export type OptionalPackageGroup = 'database' | 'storage' | 'provider' | 'document'

export interface OptionalPackage {
  /** Version range from package.json optionalDependencies. */
  version: string
  /** What needs it, as shown in errors and docs. */
  feature: string
  group: OptionalPackageGroup
  /**
   * Dockerfile build arg that keeps it in the image, with the image default;
   * null when the image always includes it.
   */
  dockerArg: { name: string; default: boolean } | null
}

const DB_ARG = { name: 'INCLUDE_OPTIONAL_DB_DRIVERS', default: false }
const STORAGE_ARG = { name: 'INCLUDE_STORAGE_SDKS', default: true }
const PROVIDER_ARG = { name: 'INCLUDE_PROVIDER_SDKS', default: true }
const OCR_ARG = { name: 'INCLUDE_OCR', default: false }

export const OPTIONAL_PACKAGES = {
  'snowflake-sdk': { version: '^2.4.0', feature: 'Snowflake connector', group: 'database', dockerArg: DB_ARG },
  oracledb: { version: '^6.10.0', feature: 'Oracle connector', group: 'database', dockerArg: DB_ARG },
  mongodb: { version: '^7.1.1', feature: 'MongoDB connector', group: 'database', dockerArg: DB_ARG },
  '@aws-sdk/client-s3': { version: '^3.1156.0', feature: 'STORAGE_PROVIDER=s3', group: 'storage', dockerArg: STORAGE_ARG },
  '@aws-sdk/s3-request-presigner': { version: '^3.1156.0', feature: 'STORAGE_PROVIDER=s3 (signed URLs)', group: 'storage', dockerArg: STORAGE_ARG },
  '@azure/storage-blob': { version: '^12.32.0', feature: 'STORAGE_PROVIDER=azure_blob', group: 'storage', dockerArg: STORAGE_ARG },
  '@google-cloud/storage': { version: '^7.22.0', feature: 'STORAGE_PROVIDER=gcs', group: 'storage', dockerArg: STORAGE_ARG },
  nodemailer: { version: '^10.2.1', feature: 'EMAIL_PROVIDER=smtp', group: 'provider', dockerArg: PROVIDER_ARG },
  '@aws-sdk/client-sesv2': { version: '^3.1156.0', feature: 'EMAIL_PROVIDER=ses', group: 'provider', dockerArg: PROVIDER_ARG },
  '@azure/communication-email': { version: '^1.1.0', feature: 'EMAIL_PROVIDER=azure_communication', group: 'provider', dockerArg: PROVIDER_ARG },
  '@aws-sdk/client-secrets-manager': { version: '^3.1156.0', feature: 'SECRETS_PROVIDER=aws_secrets_manager', group: 'provider', dockerArg: PROVIDER_ARG },
  '@azure/keyvault-secrets': { version: '^4.11.2', feature: 'SECRETS_PROVIDER=azure_key_vault', group: 'provider', dockerArg: PROVIDER_ARG },
  '@google-cloud/secret-manager': { version: '^6.3.0', feature: 'SECRETS_PROVIDER=gcp_secret_manager', group: 'provider', dockerArg: PROVIDER_ARG },
  '@aws-sdk/client-kms': { version: '^3.1156.0', feature: 'KMS_PROVIDER=aws_kms', group: 'provider', dockerArg: PROVIDER_ARG },
  '@aws-sdk/rds-signer': { version: '^3.1156.0', feature: 'DATABASE_AUTH=aws (RDS IAM auth)', group: 'provider', dockerArg: PROVIDER_ARG },
  '@aws-sdk/credential-providers': { version: '^3.1156.0', feature: 'AWS IAM credentials (ElastiCache IAM auth, CloudWatch Logs instance role)', group: 'provider', dockerArg: PROVIDER_ARG },
  // Always in the image: the SQL Server driver (tedious) depends on it too.
  '@azure/keyvault-keys': { version: '^4.10.2', feature: 'KMS_PROVIDER=azure_key_vault', group: 'provider', dockerArg: null },
  '@node-saml/node-saml': { version: '^5.1.0', feature: 'SAML sign-in', group: 'provider', dockerArg: null },
  // OCR for scanned PDFs and images in the document actions (WebAssembly, no native code; ~45 MB).
  'tesseract.js': { version: '7.0.0', feature: 'OCR in Read / Extract / Convert document (DOCUMENT_OCR_PROVIDER=tesseract)', group: 'document', dockerArg: OCR_ARG },
} as const satisfies Record<string, OptionalPackage>

export type OptionalPackageName = keyof typeof OPTIONAL_PACKAGES

export const OPTIONAL_DRIVERS_DOCS_PATH = '/docs/self-hosting/optional-drivers'

export function optionalPackageNames(group?: OptionalPackageGroup): OptionalPackageName[] {
  return (Object.keys(OPTIONAL_PACKAGES) as OptionalPackageName[])
    .filter((pkg) => !group || OPTIONAL_PACKAGES[pkg].group === group)
}

/** The stub next.config.ts bundles in place of `pkg` when it is not installed. */
export function missingStubPath(pkg: string): string {
  return `./lib/optional-drivers/missing-${pkg.replace(/^@/, '').replace(/\//g, '-')}.ts`
}

/**
 * How to add `pkg`: install, rebuild (the stub is chosen at build time, so a
 * restart alone is not enough), the Docker build arg, and the docs page.
 */
export function optionalPackageInstallHint(pkg: string): string {
  const info = (OPTIONAL_PACKAGES as Record<string, OptionalPackage>)[pkg]
  const spec = info ? `${pkg}@${info.version}` : pkg
  const docker = !info || info.dockerArg === null
    ? 'Docker: rebuild the image from this repository'
    : `Docker: rebuild the image with --build-arg ${info.dockerArg.name}=true`
  return `install it with \`npm install ${spec}\`, then rebuild (\`npm run build\`) and restart (${docker}). See ${OPTIONAL_DRIVERS_DOCS_PATH}`
}
