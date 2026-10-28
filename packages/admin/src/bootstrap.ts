import { randomBytes } from 'node:crypto'

/**
 * `usertasks-admin bootstrap`: the first tenant and its owner on a fresh
 * install, through whichever providers are configured — the database
 * provider's service client (Supabase or the in-process postgres provider)
 * and the auth provider's admin API (Supabase Auth or the built-in store).
 * The same provisioning as the cloud signup (lib/tenant-provisioning.ts).
 *
 * `--api-key <name>` also mints a tenant API key with every permission and
 * prints it once (for provisioning scripts and smoke tests).
 */

export interface BootstrapInput {
  email: string
  password: string
  org: string
  name?: string
  apiKeyName?: string
  /** An existing account for the email is not an error (re-runnable compose setups). */
  ifMissing?: boolean
}

export interface BootstrapIO {
  out: (line: string) => void
  err: (line: string) => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Validation only (pure): an error message, or null. */
export function checkBootstrapInput(input: BootstrapInput): string | null {
  if (!input.email || !input.password || !input.org) return 'bootstrap needs --email, --password (or BOOTSTRAP_PASSWORD) and --org'
  if (!EMAIL_RE.test(input.email)) return 'invalid --email'
  if (input.password.length < 8) return '--password must be at least 8 characters'
  if (input.apiKeyName !== undefined && (!input.apiKeyName.trim() || input.apiKeyName.length > 200)) return '--api-key needs a key name (1-200 characters)'
  return null
}

/**
 * `usertasks-admin storage init`: the app's buckets on the configured storage
 * provider (S3 / MinIO, Azure Blob, GCS, local disk; Supabase's come from
 * the migrations). Idempotent; bootstrap runs it too.
 */
export async function ensureStorageBuckets(io: BootstrapIO): Promise<number> {
  const [{ getStorageProvider, getStorageProviderId }, { STORAGE_BUCKETS, STORAGE_BUCKET_NAMES }] = await Promise.all([
    import('@/lib/providers/storage'),
    import('@/lib/storage/buckets'),
  ])
  const [id, provider] = await Promise.all([getStorageProviderId(), getStorageProvider()])
  try {
    for (const bucket of STORAGE_BUCKET_NAMES) await provider.ensureBucket(bucket, { public: STORAGE_BUCKETS[bucket].public })
  } catch (error) {
    io.err(`storage (${id}): ${(error as Error).message}`)
    return 1
  }
  io.out(`Storage (${id}): buckets ready: ${STORAGE_BUCKET_NAMES.join(', ')}`)
  return 0
}

export async function runBootstrap(input: BootstrapInput, io: BootstrapIO): Promise<number> {
  const problem = checkBootstrapInput(input)
  if (problem) { io.err(problem); return 2 }
  if (await ensureStorageBuckets(io)) return 1
  const email = input.email.trim().toLowerCase()
  const name = input.name?.trim() || email.split('@')[0]

  const [{ provisionTenant }, { getServiceDb }, { getAuthProvider }] = await Promise.all([
    import('@/lib/tenant-provisioning'),
    import('@/lib/providers/db'),
    import('@/lib/providers/auth'),
  ])
  // Untyped: the provisioning tables are read and written without generated types, as in tenant-provisioning.
  const serviceDb = getServiceDb()
  const db = serviceDb as unknown as { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const auth = await getAuthProvider()

  const result = await provisionTenant(serviceDb, {
    fullName: name,
    email,
    password: input.password,
    company: input.org.trim(),
    onboardingCompleted: false,
    userMetadata: { bootstrap: true },
    settings: { bootstrap: { source: 'usertasks-admin', created_at: new Date().toISOString() } },
  }, auth.admin)

  let tenantId: string
  let userId: string
  if (!result.ok) {
    if (result.reason !== 'user_exists') { io.err(`bootstrap failed (${auth.id} auth): ${result.error}`); return 1 }
    if (!input.ifMissing) { io.err(`an account for ${email} already exists`); return 1 }
    const { data: user, error } = await db.from('users').select('id, tenant_id').eq('email', email).order('created_at').limit(1).maybeSingle()
    if (error) { io.err(`bootstrap: ${error.message}`); return 1 }
    if (!user) { io.err(`an auth account for ${email} exists but has no workspace; finish it by signing in, or remove the account`); return 1 }
    const { data: tenant } = await db.from('tenants').select('slug').eq('id', user.tenant_id).maybeSingle()
    io.out(`Already bootstrapped: ${email} (tenant ${tenant?.slug ?? user.tenant_id}).`)
    if (input.apiKeyName === undefined) return 0
    tenantId = user.tenant_id
    userId = user.id
  } else {
    io.out(`Created tenant "${input.org.trim()}" (slug: ${result.slug}, id: ${result.tenantId})`)
    io.out(`Owner: ${email} (user id: ${result.userId}, ${auth.id} auth)`)
    tenantId = result.tenantId
    userId = result.userId
  }

  if (input.apiKeyName !== undefined) {
    const bcrypt = (await import('bcryptjs')).default
    const key = `ut_${randomBytes(32).toString('hex')}`
    const { error } = await db.from('api_keys').insert({
      tenant_id: tenantId,
      name: input.apiKeyName.trim(),
      key_prefix: key.slice(0, 8),
      key_hash: await bcrypt.hash(key, 10),
      key_type: 'tenant',
      // null = every permission, including ones added later (like an owner).
      permissions: null,
      created_by: userId,
    })
    if (error) { io.err(`API key: ${error.message}`); return 1 }
    io.out(`API key "${input.apiKeyName.trim()}" (shown once): ${key}`)
  }
  if (result.ok) io.out('Sign in at /login to finish setup.')
  return 0
}
