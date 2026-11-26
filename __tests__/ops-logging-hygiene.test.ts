/**
 * Ops QA (2026-11): logs carry no personal data, and audit write failures are
 * visible instead of vanishing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/providers/email', () => ({
  getEmailProviderWithOptions: async () => ({
    provider: { id: 'smtp', send: async () => ({ id: 'msg-1' }) },
    options: { from: 'UserTasks <noreply@example.com>' },
  }),
}))

afterEach(() => vi.restoreAllMocks())

describe('email logging', () => {
  it('logs counts, never recipients, subjects or file names', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { sendEmail } = await import('@/lib/email')
    const result = await sendEmail({
      to: ['alice@example.com', 'bob@example.com'], subject: 'Salary review for Alice', body: '<p>x</p>',
      attachments: [{ filename: 'alice-payslip.pdf', content: Buffer.from('x') }],
    } as never)
    expect(result.success).toBe(true)
    const text = log.mock.calls.flat().join('\n')
    expect(text).toContain('2 recipient(s), 1 attachment(s)')
    for (const secret of ['alice@example.com', 'bob@example.com', 'Salary review', 'payslip']) expect(text).not.toContain(secret)
  })
})

describe('maskEmail (directory sync warnings)', () => {
  it('keeps the first letter and the domain', async () => {
    const { maskEmail } = await import('@/lib/directory-sync/sync')
    expect(maskEmail('alice@example.com')).toBe('a***@example.com')
    expect(maskEmail(null)).toBe('(no email)')
    expect(maskEmail('nodomain')).toBe('***')
  })
})

describe('writeAudit', () => {
  it('warns when the insert reports an error (supabase-js does not throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { writeAudit } = await import('@/lib/audit-log')
    const supabase = { from: () => ({ insert: async () => ({ error: { message: 'permission denied for table object_audit_log' } }) }) }
    await writeAudit({ supabase: supabase as never, tenantId: 't', actorId: 'u', objectType: 'api_key', objectId: 'k', action: 'delete' })
    expect(warn.mock.calls.flat().join(' ')).toMatch(/writeAudit failed \(api_key delete\): permission denied/)
  })
})
