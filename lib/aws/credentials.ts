import type { AwsCredentials } from './sigv4'

/**
 * The instance's own AWS identity: the SDK's default Node.js provider chain
 * (AWS_* env, web identity / IRSA / EKS Pod Identity, the ECS task role,
 * the EC2 instance profile, SSO / shared config files), from the optional
 * @aws-sdk/credential-providers package (loaded on first use).
 *
 * One chain per process; resolved credentials are reused until five minutes
 * before they expire (the chain itself refreshes temporary credentials).
 * Nothing here logs a credential.
 */

export type AwsCredentialSource = () => Promise<AwsCredentials>

const REFRESH_MARGIN_MS = 5 * 60_000

let chain: AwsCredentialSource | null = null

/** Cache a credential source until shortly before its credentials expire; concurrent callers share one fetch. */
export function cachedCredentials(source: AwsCredentialSource, now: () => number = Date.now): AwsCredentialSource {
  let current: AwsCredentials | null = null
  let inflight: Promise<AwsCredentials> | null = null
  return async () => {
    if (current && (!current.expiration || current.expiration.getTime() - REFRESH_MARGIN_MS > now())) return current
    inflight ??= source().finally(() => { inflight = null })
    current = await inflight
    return current
  }
}

/** The default provider chain (shared per process). */
export function instanceCredentials(): AwsCredentialSource {
  chain ??= cachedCredentials(async () => {
    const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers')
    const identity = await fromNodeProviderChain()()
    return {
      accessKeyId: identity.accessKeyId,
      secretAccessKey: identity.secretAccessKey,
      ...(identity.sessionToken ? { sessionToken: identity.sessionToken } : {}),
      ...(identity.expiration ? { expiration: identity.expiration } : {}),
    }
  })
  return chain
}

/** Replace the instance chain (tests); null restores the default. */
export function setInstanceCredentialsForTests(source: AwsCredentialSource | null): void {
  chain = source
}

/** AWS_REGION / AWS_DEFAULT_REGION. */
export function defaultAwsRegion(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || undefined
}

export const AWS_REGION_PATTERN = /^[a-z]{2}(-gov|-iso[a-z]*)?-[a-z]+-\d$/
