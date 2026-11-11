import { isCloud } from '@/lib/deployment'

/**
 * Whether the welcome carries the beta lines ("thank you for joining the
 * beta…"). Runtime server config, not a build-time NEXT_PUBLIC variable:
 * USERTASKS_BETA=on|off (also true/false/1/0). Unset: on in cloud mode, off
 * for self-hosted installs. Turn it off at general release.
 */
export function betaWelcomeOn(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.USERTASKS_BETA?.trim().toLowerCase()
  if (raw === 'on' || raw === 'true' || raw === '1') return true
  if (raw === 'off' || raw === 'false' || raw === '0') return false
  return isCloud()
}
