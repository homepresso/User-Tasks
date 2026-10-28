/**
 * `npm run stack`: the Docker Compose deployment profiles in one command
 * (docs/deployment-profiles.md).
 *
 *   npm run stack -- init  [--profile <p>] [--port 3000] [--email you@example.com] [--force]
 *   npm run stack -- up    [--profile <p>] [--email … --org … [--password …]] [--no-build] [--pgbouncer] [--keycloak]
 *                          [--kms env|vault_transit|aws_kms|azure_key_vault|gcp_kms]
 *   npm run stack -- smoke [--profile <p>]
 *   npm run stack -- down  [--profile <p>] [--volumes]
 *   npm run stack -- compose [--profile <p>] -- <docker compose args…>
 *
 * Profiles:
 *   standalone  PostgreSQL 16 + MinIO + worker + built-in auth + SSE + Mailpit (env file: .env)
 *   onprem      standalone in a network-isolated Docker network (no outbound internet),
 *               optional Keycloak OIDC (--keycloak)
 *   azure       Azure emulation: Azurite Blob, Key Vault / managed identity / ACS email /
 *               Entra OIDC stand-ins, external tick like a Container Apps Job
 *   gcp         Google Cloud emulation: fake-gcs-server, metadata server (ADC) and
 *               Secret Manager stand-ins, external tick like Cloud Scheduler, SMTP relay
 *   aws         AWS emulation: LocalStack (S3, Secrets Manager, KMS, CloudWatch Logs),
 *               ECS task-role credentials, SES v2 and Cognito OIDC stand-ins, external
 *               tick like an EventBridge API destination
 * KMS stand-ins (deploy/compose/kms.yml, the mocks, LocalStack): onprem uses OpenBao
 * Transit, azure a Key Vault key, gcp Cloud KMS, aws LocalStack KMS; `--kms aws_kms`
 * adds local-kms to the other profiles, `--kms env` turns envelope encryption off.
 * `up` creates the first data key (`kms rotate`) and restarts the app on it.
 * The reference profiles (onprem, azure, gcp, aws) are release gates: `up`, `smoke`,
 * `down --volumes`. Their env files and test certificates live in
 * deploy/compose/.state/ (git-ignored).
 *
 * `init` writes the env file from deploy/compose/standalone.env.example with
 * fresh secrets (refuses to overwrite without --force). `up` runs init when
 * the file is missing, builds and starts the stack (`docker compose up
 * --wait`), and creates the first workspace when --email and --org are
 * given (a generated password is printed when --password is not).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = path.resolve(__dirname, '..')
const STATE = path.join(ROOT, 'deploy/compose/.state')

type ProfileName = 'standalone' | 'onprem' | 'azure' | 'gcp' | 'aws'
type KmsChoice = 'env' | 'vault_transit' | 'aws_kms' | 'azure_key_vault' | 'gcp_kms'

interface Profile {
  files: string[]
  profiles: string[]
  /** Compose project name (default: the directory name, like plain `docker compose`). */
  project?: string
  envFile: string
  /** Values applied over the standalone template. */
  overrides: Record<string, string>
  /** Smoke container settings. */
  smoke: Record<string, string>
  certs?: boolean
  /** The KMS stand-in the profile uses unless --kms says otherwise. */
  kms: KmsChoice
  /** Services that run the app's code (restarted on a new data key). */
  appServices: string[]
  /** The profile's own overrides configure its KMS stand-in (no deploy/compose/kms.yml). */
  kmsBuiltIn?: boolean
}

const AZURITE_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='

const PROFILES: Record<ProfileName, Profile> = {
  standalone: {
    files: ['docker-compose.yml'],
    profiles: ['standalone'],
    envFile: path.join(ROOT, '.env'),
    overrides: {},
    smoke: { SMOKE_MAIL: 'mailpit' },
    kms: 'env',
    appServices: ['app', 'worker'],
  },
  onprem: {
    files: ['docker-compose.yml', 'deploy/compose/onprem.yml'],
    profiles: ['standalone'],
    project: 'usertasks-onprem',
    envFile: path.join(STATE, 'onprem.env'),
    overrides: {},
    smoke: { SMOKE_MAIL: 'mailpit' },
    kms: 'vault_transit',
    appServices: ['app', 'worker'],
  },
  azure: {
    files: ['docker-compose.yml', 'deploy/compose/azure.yml'],
    profiles: ['azure'],
    project: 'usertasks-azure',
    envFile: path.join(STATE, 'azure.env'),
    certs: true,
    overrides: {
      STORAGE_PROVIDER: 'azure_blob',
      AZURE_STORAGE_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_KEY};BlobEndpoint=http://azurite:10000/devstoreaccount1;`,
      STORAGE_BUCKET_PREFIX: 'usertasks-',
      // Managed identity, as Container Apps provides it (IDENTITY_ENDPOINT / IDENTITY_HEADER).
      IDENTITY_ENDPOINT: 'http://mocks:8080/msi/token',
      IDENTITY_HEADER: 'local-identity-header',
      SECRETS_PROVIDER: 'azure_key_vault',
      AZURE_KEY_VAULT_URL: 'https://usertasks.vault.azure.net',
      // ENCRYPTION_KEY comes from Key Vault (secret "encryption-key").
      ENCRYPTION_KEY: 'secret://encryption-key',
      EMAIL_PROVIDER: 'azure_communication',
      ACS_EMAIL_CONNECTION_STRING: `endpoint=https://usertasks.communication.azure.com/;accesskey=${Buffer.from('local-acs-key').toString('base64')}`,
      EMAIL_FROM: 'DoNotReply@usertasks.azurecomm.net',
      // The tick arrives from outside, like a Container Apps Job (the `tick` container).
      SCHEDULER_PROVIDER: 'external',
      AUTH_SSO_PROVIDERS: JSON.stringify([{ id: 'entra', type: 'oidc', issuer: 'http://mocks:8080/entra/00000000-0000-0000-0000-000000000000/v2.0', clientId: 'usertasks-local', clientSecret: 'secret://entra-client-secret' }]),
      NODE_EXTRA_CA_CERTS: '/certs/ca.pem',
      // Log export to the Azure Monitor stand-in with the managed identity.
      LOG_EXPORT_ALLOW_INSTANCE_IDENTITY: 'true',
      ALLOW_PRIVATE_EGRESS: 'true',
    },
    smoke: {
      SMOKE_MAIL: 'acs-mock',
      SMOKE_LOGS: 'azure_monitor',
      SMOKE_LOGS_CONFIG: JSON.stringify({ endpoint: 'http://mocks:8080', dcr_immutable_id: `dcr-${'0'.repeat(32)}`, stream_name: 'Custom-UserTasks_CL', auth: 'managed_identity' }),
    },
    kms: 'azure_key_vault',
    appServices: ['app'],
  },
  gcp: {
    files: ['docker-compose.yml', 'deploy/compose/gcp.yml'],
    profiles: ['gcp'],
    project: 'usertasks-gcp',
    envFile: path.join(STATE, 'gcp.env'),
    overrides: {
      STORAGE_PROVIDER: 'gcs',
      GCS_API_ENDPOINT: 'http://fake-gcs:4443',
      GCS_PROJECT_ID: 'usertasks-local',
      STORAGE_BUCKET_PREFIX: 'usertasks-',
      // Application Default Credentials from the metadata server, as on Cloud Run.
      GCE_METADATA_HOST: 'mocks:8080',
      METADATA_SERVER_DETECTION: 'assume-present',
      GOOGLE_CLOUD_PROJECT: 'usertasks-local',
      SECRETS_PROVIDER: 'gcp_secret_manager',
      GCP_SECRET_MANAGER_PROJECT: 'usertasks-local',
      GCP_SECRET_MANAGER_ENDPOINT: 'http://mocks:8080',
      ENCRYPTION_KEY: 'secret://encryption-key',
      // SMTP relay (Workspace SMTP relay in the cloud; Mailpit here), password from Secret Manager.
      SMTP_USER: 'usertasks',
      SMTP_PASSWORD: 'secret://smtp-password',
      SCHEDULER_PROVIDER: 'external',
      AUTH_SSO_PROVIDERS: JSON.stringify([{ id: 'google', type: 'oidc', issuer: 'http://mocks:8080/google', clientId: 'usertasks-local', clientSecret: 'secret://google-client-secret' }]),
      // Log export to the Cloud Logging stand-in with workload identity (ADC from the metadata stand-in).
      LOG_EXPORT_GCP_LOGGING_URL: 'http://mocks:8080',
      LOG_EXPORT_ALLOW_INSTANCE_IDENTITY: 'true',
      ALLOW_PRIVATE_EGRESS: 'true',
    },
    smoke: {
      SMOKE_MAIL: 'mailpit',
      SMOKE_LOGS: 'gcp_logging',
      SMOKE_LOGS_CONFIG: JSON.stringify({ project_id: 'usertasks-local', log_id: 'usertasks-smoke', auth: 'workload_identity' }),
    },
    kms: 'gcp_kms',
    appServices: ['app'],
  },
  aws: {
    files: ['docker-compose.yml', 'deploy/compose/aws.yml'],
    profiles: ['aws'],
    project: 'usertasks-aws',
    envFile: path.join(STATE, 'aws.env'),
    certs: true,
    overrides: {
      AWS_REGION: 'eu-west-1',
      // The ECS task role: container credentials from the mocks container (HTTPS, test CA).
      AWS_CONTAINER_CREDENTIALS_FULL_URI: 'https://mocks:8443/ecs/credentials',
      AWS_CONTAINER_AUTHORIZATION_TOKEN: 'local-ecs-credentials-token',
      NODE_EXTRA_CA_CERTS: '/certs/ca.pem',
      STORAGE_PROVIDER: 's3',
      S3_ENDPOINT: 'http://localstack:4566',
      S3_REGION: 'eu-west-1',
      S3_FORCE_PATH_STYLE: 'true',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      STORAGE_BUCKET_PREFIX: 'usertasks-',
      SECRETS_PROVIDER: 'aws_secrets_manager',
      AWS_SECRETS_MANAGER_ENDPOINT: 'http://localstack:4566',
      // ENCRYPTION_KEY comes from Secrets Manager (seeded by deploy/compose/localstack/init-aws.sh).
      ENCRYPTION_KEY: 'secret://usertasks/encryption-key',
      KMS_PROVIDER: 'aws_kms',
      AWS_KMS_KEY_ID: 'alias/usertasks',
      AWS_KMS_ENDPOINT: 'http://localstack:4566',
      EMAIL_PROVIDER: 'ses',
      SES_REGION: 'eu-west-1',
      // SES v2 is not in LocalStack's community edition: the mocks container answers SendEmail.
      AWS_ENDPOINT_URL_SESV2: 'http://mocks:8080',
      EMAIL_FROM: 'UserTasks <noreply@usertasks.local>',
      // The tick arrives from outside, like an EventBridge API destination (the `tick` container).
      SCHEDULER_PROVIDER: 'external',
      AUTH_SSO_PROVIDERS: JSON.stringify([{ id: 'cognito', type: 'oidc', preset: 'cognito', userPoolId: 'eu-west-1_Local', issuer: 'http://mocks:8080/cognito/eu-west-1_Local', clientId: 'usertasks-local' }]),
      // Log export to CloudWatch Logs (LocalStack) with the task role.
      LOG_EXPORT_AWS_ENDPOINT_URL: 'http://localstack:4566',
      LOG_EXPORT_ALLOW_INSTANCE_IDENTITY: 'true',
      ALLOW_PRIVATE_EGRESS: 'true',
    },
    smoke: {
      SMOKE_MAIL: 'ses-mock',
      SMOKE_LOGS: 'aws_cloudwatch_logs',
      SMOKE_LOGS_CONFIG: JSON.stringify({ region: 'eu-west-1', log_group_name: '/usertasks/smoke', log_stream_name: 'events', auto_create: true, auth: 'instance_role' }),
    },
    kms: 'aws_kms',
    kmsBuiltIn: true,
    appServices: ['app'],
  },
}

/** Environment for each KMS stand-in. */
function kmsOverrides(kms: KmsChoice): Record<string, string> {
  switch (kms) {
    case 'vault_transit':
      return { KMS_PROVIDER: 'vault_transit', VAULT_ADDR: 'http://openbao:8200', VAULT_TOKEN: hex(24), VAULT_TRANSIT_KEY: 'usertasks' }
    case 'aws_kms':
      return {
        KMS_PROVIDER: 'aws_kms', AWS_KMS_KEY_ID: 'alias/usertasks', AWS_KMS_REGION: 'us-east-1', AWS_KMS_ENDPOINT: 'http://local-kms:8080',
        AWS_ACCESS_KEY_ID: 'local-kms', AWS_SECRET_ACCESS_KEY: 'local-kms',
      }
    case 'azure_key_vault':
      return { KMS_PROVIDER: 'azure_key_vault', AZURE_KMS_KEY_ID: 'https://usertasks.vault.azure.net/keys/usertasks', MOCK_KMS_SECRET: hex(24) }
    case 'gcp_kms':
      return {
        KMS_PROVIDER: 'gcp_kms', GCP_KMS_KEY_NAME: 'projects/usertasks-local/locations/global/keyRings/usertasks/cryptoKeys/usertasks',
        GCP_KMS_ENDPOINT: 'http://mocks:8080', MOCK_KMS_SECRET: hex(24),
      }
    default:
      return {}
  }
}

const KMS_COMPOSE_PROFILE: Partial<Record<KmsChoice, string>> = { vault_transit: 'kms-vault', aws_kms: 'kms-aws' }

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    profile: { type: 'string', default: 'standalone' },
    'env': { type: 'string' },
    project: { type: 'string' },
    port: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    org: { type: 'string' },
    force: { type: 'boolean' },
    'no-build': { type: 'boolean' },
    pgbouncer: { type: 'boolean' },
    keycloak: { type: 'boolean' },
    kms: { type: 'string' },
    volumes: { type: 'boolean', short: 'v' },
  },
})

const [command, ...rest] = positionals
const name = values.profile as ProfileName
const profile = PROFILES[name]
if (!profile) fail(`unknown --profile ${values.profile} (standalone, onprem, azure, gcp, aws)`)
const envFile = path.resolve(values.env ?? profile.envFile)
const project = values.project ?? profile.project
const KMS_CHOICES: KmsChoice[] = ['env', 'vault_transit', 'aws_kms', 'azure_key_vault', 'gcp_kms']
if (values.kms && !KMS_CHOICES.includes(values.kms as KmsChoice)) fail(`unknown --kms ${values.kms} (${KMS_CHOICES.join(', ')})`)
if ((values.kms === 'azure_key_vault' && name !== 'azure') || (values.kms === 'gcp_kms' && name !== 'gcp')) fail(`--kms ${values.kms} needs the ${values.kms === 'gcp_kms' ? 'gcp' : 'azure'} profile (its stand-in is in the mocks)`)

/** The KMS the stack runs with: what the env file says once it exists, else --kms or the profile's. */
function stackKms(): KmsChoice {
  if (existsSync(envFile)) return (readEnvFile(envFile).KMS_PROVIDER as KmsChoice | undefined) ?? 'env'
  return (values.kms as KmsChoice | undefined) ?? profile.kms
}

function fail(message: string): never {
  console.error(`stack: ${message}`)
  process.exit(1)
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex')

/** The env file's values (KEY=value lines). */
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function init(): void {
  if (existsSync(envFile) && !values.force) {
    console.log(`${path.relative(ROOT, envFile)} exists; keeping it (--force writes a new one).`)
    return
  }
  // Reference profiles get their own host ports so they never collide with a dev server on 3000.
  const port = values.port ?? { standalone: '3000', onprem: '3400', azure: '3401', gcp: '3402', aws: '3403' }[name]
  const pgPassword = hex(18)
  const secrets: Record<string, string> = { ENCRYPTION_KEY: hex(32), CRON_SECRET: hex(32), POSTGRES_PASSWORD: pgPassword, S3_SECRET_ACCESS_KEY: hex(18) }
  let text = readFileSync(path.join(ROOT, 'deploy/compose/standalone.env.example'), 'utf8')
    .replace(/^([A-Z0-9_]+)=<generate>$/gm, (_, key: string) => `${key}=${secrets[key] ?? hex(24)}`)
    .replaceAll('<POSTGRES_PASSWORD>', pgPassword)
    .replace(/^(APP_URL|NEXT_PUBLIC_APP_URL)=.*$/gm, (_, key: string) => `${key}=http://localhost:${port}`)
    .replace(/^APP_PORT=.*$/m, `APP_PORT=${port}`)
  if (values.email) text = text.replace(/^INSTANCE_ADMIN_EMAILS=.*$/m, `INSTANCE_ADMIN_EMAILS=${values.email}`)
  if (values.pgbouncer) text = text.replace(/^DATABASE_URL=(.*)@postgres:5432/m, 'DATABASE_URL=$1@pgbouncer:5432')
  // The aws profile's own overrides are its KMS stand-in (LocalStack); --kms picks another.
  const kmsChoice = (values.kms as KmsChoice | undefined) ?? profile.kms
  const overrides = { ...profile.overrides, ...(profile.kmsBuiltIn && kmsChoice === profile.kms ? {} : kmsOverrides(kmsChoice)) }
  if (name === 'azure' || name === 'gcp' || name === 'aws') {
    // The values the cloud secret store stand-ins serve (MOCK_SECRETS in the overlay).
    overrides.MOCK_ENCRYPTION_KEY = secrets.ENCRYPTION_KEY
  }
  for (const [key, value] of Object.entries(overrides)) {
    const line = `${key}=${value}`
    text = new RegExp(`^${key}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}=.*$`, 'm'), () => line) : `${text.trimEnd()}\n${line}\n`
  }
  if (values.keycloak) {
    text += `AUTH_SSO_PROVIDERS=${JSON.stringify([{ id: 'keycloak', type: 'oidc', preset: 'keycloak', baseUrl: 'http://keycloak:8080', realm: 'usertasks', clientId: 'usertasks', clientSecret: 'usertasks-local-secret' }])}\n`
  }
  mkdirSync(path.dirname(envFile), { recursive: true })
  writeFileSync(envFile, text, { mode: 0o600 })
  chmodSync(envFile, 0o600)
  console.log(`Wrote ${path.relative(ROOT, envFile)} (${name} profile, fresh secrets).`)
}

/** A private CA and a server certificate for the TLS-only stand-ins (Key Vault, ACS). */
function ensureCerts(): void {
  const dir = path.join(STATE, 'certs')
  if (existsSync(path.join(dir, 'server.pem'))) return
  mkdirSync(dir, { recursive: true })
  const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
  run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca-key.pem', '-out', 'ca.pem', '-days', '365', '-subj', '/CN=UserTasks local test CA')
  run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server-key.pem', '-out', 'server.csr', '-subj', '/CN=mocks')
  writeFileSync(path.join(dir, 'ext.cnf'), 'subjectAltName=DNS:mocks,DNS:usertasks.vault.azure.net,DNS:usertasks.communication.azure.com\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n')
  run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial', '-out', 'server.pem', '-days', '365', '-extfile', 'ext.cnf')
  // Readable by the app container's non-root user.
  for (const f of ['ca.pem', 'server.pem', 'server-key.pem']) chmodSync(path.join(dir, f), 0o644)
}

function composeArgs(extraProfiles: string[] = []): string[] {
  const args = ['compose', ...(project ? ['-p', project] : []), '--project-directory', ROOT]
  const kms = stackKms()
  const kmsProfile = profile.kmsBuiltIn && kms === profile.kms ? undefined : KMS_COMPOSE_PROFILE[kms]
  for (const f of [...profile.files, ...(kmsProfile ? ['deploy/compose/kms.yml'] : [])]) args.push('-f', path.join(ROOT, f))
  args.push('--env-file', envFile)
  const active = [...profile.profiles, ...extraProfiles, ...(kmsProfile ? [kmsProfile] : [])]
  if (values.pgbouncer) active.push('pgbouncer')
  if (values.keycloak) active.push('keycloak')
  for (const p of active) args.push('--profile', p)
  return args
}

const composeEnv = () => ({ ...process.env, USERTASKS_ENV_FILE: envFile, USERTASKS_STATE_DIR: STATE })

function compose(args: string[], opts: { capture?: boolean; extraProfiles?: string[]; allowFail?: boolean; input?: string } = {}): { status: number; stdout: string } {
  const res = spawnSync('docker', [...composeArgs(opts.extraProfiles), ...args], {
    cwd: ROOT, env: composeEnv(), encoding: 'utf8', input: opts.input,
    stdio: opts.capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  })
  if (res.status !== 0 && !opts.allowFail) {
    if (opts.capture) process.stderr.write(res.stderr ?? '')
    fail(`docker ${[...args].slice(0, 3).join(' ')}… exited with ${res.status}`)
  }
  return { status: res.status ?? 1, stdout: res.stdout ?? '' }
}

function adminExec(args: string[], env: Record<string, string> = {}, allowFail = false) {
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  return compose(['exec', '-T', ...envArgs, 'app', 'node', 'admin.cjs', ...args], { capture: true, allowFail })
}

function bootstrap(email: string, org: string, password: string, apiKey?: string): { key?: string; stdout: string } {
  const res = adminExec(['bootstrap', '--email', email, '--org', org, '--if-missing', ...(apiKey ? ['--api-key', apiKey] : [])], { BOOTSTRAP_PASSWORD: password })
  process.stdout.write(res.stdout.replace(/ut_[0-9a-f]{64}/g, 'ut_…'))
  return { key: res.stdout.match(/ut_[0-9a-f]{64}/)?.[0], stdout: res.stdout }
}

/**
 * Envelope encryption on: the first data key (wrapped by the stand-in), then
 * the app restarted so it starts on it (the fail-closed startup path), then
 * every stored secret re-encrypted with it.
 */
function ensureDataKey(): void {
  const kms = stackKms()
  if (kms === 'env') return
  const status = adminExec(['kms', 'status', '--json'], {}, true)
  let keys: unknown[] = []
  try { keys = JSON.parse(status.stdout).keys ?? [] } catch { /* not JSON: no schema yet */ }
  if (keys.length) return
  console.log(`\nKMS (${kms}): creating the first data key, then restarting ${profile.appServices.join(', ')} on it.`)
  process.stdout.write(adminExec(['kms', 'rotate', '--activate-in', '0', '--yes']).stdout)
  compose(['restart', ...profile.appServices])
  compose(['up', '-d', '--wait', '--no-build'])
  process.stdout.write(adminExec(['kms', 'rewrap', '--yes']).stdout)
}

function up(): void {
  if (!existsSync(envFile)) init()
  if (profile.certs) ensureCerts()
  compose(['up', '-d', '--wait', ...(values['no-build'] ? [] : ['--build'])])
  ensureDataKey()
  const env = readEnvFile(envFile)
  console.log(name === 'onprem'
    ? '\nUserTasks is up on an isolated network (nothing is published on the host; `npm run stack -- smoke --profile onprem` tests it from inside).'
    : `\nUserTasks is up: ${env.APP_URL ?? 'http://localhost:3000'}${profile.smoke.SMOKE_MAIL === 'mailpit' ? ` (Mailpit: http://localhost:${env.MAILPIT_PORT ?? '8025'})` : ''}`)
  if (values.email && values.org) {
    const password = values.password ?? process.env.BOOTSTRAP_PASSWORD ?? randomBytes(12).toString('base64url')
    bootstrap(values.email, values.org, password)
    if (!values.password && !process.env.BOOTSTRAP_PASSWORD) console.log(`Password (shown once): ${password}`)
  } else {
    console.log('Create the first workspace: npm run stack -- up --email you@example.com --org "Your org"  (or: docker compose exec app node admin.cjs bootstrap …)')
  }
}

function signInActionId(): string {
  const manifest = compose(['exec', '-T', 'app', 'cat', '.next/server/server-reference-manifest.json'], { capture: true }).stdout
  const entry = Object.entries(JSON.parse(manifest).node as Record<string, { exportedName?: string; filename?: string }>)
    .find(([, v]) => v.exportedName === 'signInAction' && v.filename === 'app/actions/auth.ts')
  if (!entry) fail('signInAction not found in the server reference manifest')
  return entry[0]
}

type DoctorCheck = { area: string; name: string; status: string; detail: string }

async function smoke(): Promise<void> {
  if (!existsSync(envFile)) fail(`${path.relative(ROOT, envFile)} is missing: run \`npm run stack -- up --profile ${name}\` first`)
  const run = Date.now().toString(36)
  const email = `smoke-${run}@usertasks.test`
  const password = randomBytes(12).toString('base64url')
  const boot = bootstrap(email, `Smoke ${run}`, password, `smoke ${run}`)
  if (!boot.key) fail('bootstrap did not print an API key')
  const slug = boot.stdout.match(/slug: ([a-z0-9-]+)/)?.[1] ?? ''

  // 1. HTTP checks from inside the deployment's network.
  const env = readEnvFile(envFile)
  const smokeEnv: Record<string, string> = {
    SMOKE_URL: 'http://app:3000',
    SMOKE_API_KEY: boot.key,
    SMOKE_EMAIL: email,
    SMOKE_PASSWORD: password,
    SMOKE_ORG: slug,
    SMOKE_SIGNIN_ACTION: signInActionId(),
    SMOKE_REALTIME: env.REALTIME_PROVIDER === 'sse' ? 'sse' : 'skip',
    ...profile.smoke,
  }
  const envArgs = Object.entries(smokeEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const http = compose(['run', '--rm', ...envArgs, 'smoke'], { extraProfiles: ['smoke'], allowFail: true })

  // 2. Every provider's doctor checks, waiting for the scheduler's first tick.
  let checks: DoctorCheck[] = []
  for (let i = 0; i < 18; i++) {
    const res = adminExec(['doctor', '--json'], {}, true)
    try { checks = JSON.parse(res.stdout).checks } catch { checks = [] }
    const tick = checks.find((c) => c.area === 'scheduler' && c.name === 'last tick')
    if (tick?.status === 'ok' && !checks.some((c) => c.status === 'fail')) break
    await new Promise((r) => setTimeout(r, 10_000))
  }
  console.log('\nusertasks-admin doctor:')
  for (const c of checks) console.log(`  ${c.status.padEnd(4)}  ${c.area.padEnd(9)} ${c.name.padEnd(16)} ${c.detail}`)
  const doctorFailed = !checks.length || checks.some((c) => c.status === 'fail') || checks.find((c) => c.name === 'last tick')?.status !== 'ok'

  // 3. Envelope encryption: the configured KMS wraps the active data key, and it is loaded.
  let kmsFailed = false
  const kms = stackKms()
  if (kms !== 'env') {
    const res = adminExec(['kms', 'status', '--json'], {}, true)
    let status: { provider?: string; activeKeyId?: number | null; keys?: { id: number; provider: string; active: boolean; loaded: boolean }[] } = {}
    try { status = JSON.parse(res.stdout) } catch { /* reported below */ }
    const active = status.keys?.find((k) => k.active)
    kmsFailed = status.provider !== kms || !active || !active.loaded || active.provider !== kms
    console.log(`\n${kmsFailed ? 'FAIL' : 'ok  '}  KMS ${kms}: ${active ? `data key #${active.id} active, wrapped by ${active.provider}${active.loaded ? ', unwrapped' : ', NOT unwrapped'}` : 'no active data key'}`)
  }

  // 4. Network isolation (on-prem): the app must not reach the internet.
  let egressFailed = false
  if (name === 'onprem') {
    const egress = compose(['exec', '-T', 'app', 'wget', '-q', '-T', '5', '-O', '/dev/null', 'https://registry.npmjs.org/'], { capture: true, allowFail: true })
    egressFailed = egress.status === 0
    console.log(`\n${egressFailed ? 'FAIL' : 'ok  '}  no outbound internet from the app container${egressFailed ? ' (a request to registry.npmjs.org succeeded)' : ''}`)
  }

  const ok = http.status === 0 && !doctorFailed && !egressFailed && !kmsFailed
  console.log(`\n${name} profile smoke: ${ok ? 'PASSED' : 'FAILED'}`)
  process.exit(ok ? 0 : 1)
}

async function main() {
  switch (command) {
    case 'init':
      if (profile.certs) ensureCerts()
      return init()
    case 'up':
      return up()
    case 'smoke':
      return smoke()
    case 'down':
      compose(['down', ...(values.volumes ? ['--volumes'] : []), '--remove-orphans'], { extraProfiles: ['smoke'] })
      return
    case 'compose':
      compose(rest)
      return
    default:
      console.log(readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*\n?/, '').replace(/^ \* ?/gm, ''))
      process.exit(command ? 2 : 0)
  }
}

main().catch((error) => fail(String(error?.message ?? error)))
