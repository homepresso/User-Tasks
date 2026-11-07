/**
 * #8 internal signing key (lib/config/signing): queued resumes and run
 * initiators are signed with WORKFLOW_SIGNING_SECRET, else a key derived
 * from ENCRYPTION_KEY, else the service-role key (legacy), and verify
 * against any configured key — so the standalone profile (no Supabase) can
 * resume runs, and jobs queued before an upgrade still run after it.
 */
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentSigningKey, requireSigningKey, signingKeys } from '@/lib/config/signing'
import { readQueuedInitiator, withQueuedInitiator } from '@/lib/workflow-initiator'
import { runQueuedResume, signResume } from '@/lib/workflow-resume-queue'

const NAMES = ['WORKFLOW_SIGNING_SECRET', 'ENCRYPTION_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const saved: Record<string, string | undefined> = {}
const ENC = 'a'.repeat(64)
const SRK = 'legacy-service-role-key'

function setEnv(values: Partial<Record<(typeof NAMES)[number], string>>) {
  for (const name of NAMES) {
    if (values[name] === undefined) delete process.env[name]
    else process.env[name] = values[name]
  }
}

beforeEach(() => {
  for (const name of NAMES) saved[name] = process.env[name]
})
afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

const TARGET = { tenantId: 't1', workflowId: 'w1', runId: 'r1', eventId: 'e1', payload: '{"ok":true}' }
const legacyResumeSig = (key: string) =>
  createHmac('sha256', key).update(['task_resume', 't1', 'w1', 'r1', 'e1', '{"ok":true}'].join('\n')).digest('hex')

/** The verify step of runQueuedResume, without a database: a bad signature is skipped before any read. */
async function resumeVerifies(sig: string): Promise<boolean> {
  const supabase = {
    from: () => { throw new Error('verified') },
  }
  try {
    const out = await runQueuedResume({ run_id: 'r1', event_id: 'e1', payload: '{"ok":true}', sig }, { tenantId: 't1', workflowId: 'w1' }, { supabase: supabase as never })
    return out.reason !== 'Resume job signature is invalid'
  } catch (error) {
    return (error as Error).message === 'verified'
  }
}

describe('signing key resolution', () => {
  it('prefers WORKFLOW_SIGNING_SECRET, then ENCRYPTION_KEY (derived), then the service-role key', () => {
    setEnv({ WORKFLOW_SIGNING_SECRET: ' dedicated ', ENCRYPTION_KEY: ENC, SUPABASE_SERVICE_ROLE_KEY: SRK })
    expect(signingKeys().map((k) => k.source)).toEqual(['WORKFLOW_SIGNING_SECRET', 'ENCRYPTION_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
    expect(currentSigningKey()!.key.toString()).toBe('dedicated')

    setEnv({ ENCRYPTION_KEY: ENC, SUPABASE_SERVICE_ROLE_KEY: SRK })
    const derived = currentSigningKey()!
    expect(derived.source).toBe('ENCRYPTION_KEY')
    // Derived, never the encryption key itself; stable across calls.
    expect(derived.key.length).toBe(32)
    expect(derived.key.toString('hex')).not.toBe(ENC)
    expect(currentSigningKey()!.key.equals(derived.key)).toBe(true)

    setEnv({ SUPABASE_SERVICE_ROLE_KEY: SRK })
    expect(currentSigningKey()!.source).toBe('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('has no key with nothing configured, and ignores an unresolved secret:// reference', () => {
    setEnv({})
    expect(currentSigningKey()).toBeNull()
    expect(() => requireSigningKey()).toThrow(/WORKFLOW_SIGNING_SECRET/)
    setEnv({ WORKFLOW_SIGNING_SECRET: 'secret://signing', ENCRYPTION_KEY: 'secret://enc' })
    expect(signingKeys()).toEqual([])
  })
})

describe('queued resumes', () => {
  it('standalone (no service-role key): signs with the key derived from ENCRYPTION_KEY and verifies', async () => {
    setEnv({ ENCRYPTION_KEY: ENC })
    const sig = signResume(TARGET)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    expect(await resumeVerifies(sig)).toBe(true)
    expect(await resumeVerifies(legacyResumeSig('forged'))).toBe(false)
  })

  it('upgrade: a job signed with the service-role key before the deploy still verifies; new jobs use the new key', async () => {
    setEnv({ ENCRYPTION_KEY: ENC, SUPABASE_SERVICE_ROLE_KEY: SRK })
    expect(await resumeVerifies(legacyResumeSig(SRK))).toBe(true)
    expect(signResume(TARGET)).not.toBe(legacyResumeSig(SRK))
    expect(await resumeVerifies(signResume(TARGET))).toBe(true)
  })

  it('adding WORKFLOW_SIGNING_SECRET later keeps jobs signed with the derived key verifying', async () => {
    setEnv({ ENCRYPTION_KEY: ENC })
    const before = signResume(TARGET)
    setEnv({ WORKFLOW_SIGNING_SECRET: 'dedicated', ENCRYPTION_KEY: ENC })
    expect(await resumeVerifies(before)).toBe(true)
    expect(signResume(TARGET)).not.toBe(before)
  })

  it('a Supabase deployment without ENCRYPTION_KEY signs exactly as before (service-role key)', () => {
    setEnv({ SUPABASE_SERVICE_ROLE_KEY: SRK })
    expect(signResume(TARGET)).toBe(legacyResumeSig(SRK))
  })

  it('with no key at all, queuing names the variable to set', () => {
    setEnv({})
    expect(() => signResume(TARGET)).toThrow(/WORKFLOW_SIGNING_SECRET \(or ENCRYPTION_KEY\)/)
  })
})

describe('queued initiators', () => {
  const target = { tenantId: 't1', workflowId: 'w1' }
  const initiator = { userId: 'u1', via: 'api' as const }

  it('standalone: signs (never silently skips) and verifies with the derived key', () => {
    setEnv({ ENCRYPTION_KEY: ENC })
    const data = withQueuedInitiator({ a: 1 }, target, initiator)
    expect(data._started_by).toBeTruthy()
    expect(readQueuedInitiator(data, target)).toEqual(initiator)
  })

  it('upgrade: an initiator signed with the service-role key verifies after ENCRYPTION_KEY signing takes over', () => {
    setEnv({ SUPABASE_SERVICE_ROLE_KEY: SRK })
    const old = withQueuedInitiator({ a: 1 }, target, initiator)
    setEnv({ ENCRYPTION_KEY: ENC, SUPABASE_SERVICE_ROLE_KEY: SRK })
    expect(readQueuedInitiator(old, target)).toEqual(initiator)
    const fresh = withQueuedInitiator({ a: 1 }, target, initiator)
    expect((fresh._started_by as { sig: string }).sig).not.toBe((old._started_by as { sig: string }).sig)
    expect(readQueuedInitiator(fresh, target)).toEqual(initiator)
    // A key the server doesn't hold never verifies.
    setEnv({ ENCRYPTION_KEY: 'b'.repeat(64) })
    expect(readQueuedInitiator(fresh, target)).toBeNull()
  })
})
