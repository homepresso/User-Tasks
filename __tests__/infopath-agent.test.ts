import { describe, expect, it } from 'vitest'
import { convertAttachment } from '@/lib/assistants/attachments'
import { attachmentForStorage, sanitizeAttachments } from '@/lib/assistants/attachments-core'
import { infopathTools, INFOPATH_TOOL } from '@/lib/assistants/tools/infopath'
import type { ServiceContext } from '@/lib/services/context'
import { fixtureXsn } from './helpers/infopath-fixtures'

const db = () => {
  const q: any = { select: () => q, eq: () => q, limit: () => q, then: (r: (v: unknown) => void) => r({ data: [], error: null }) }
  return { from: () => q }
}
const ctx = (perms: string[]): ServiceContext => ({ supabase: db() as never, tenantId: 't1', actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui' } as ServiceContext)

describe('Agent: InfoPath attachments', () => {
  it('turns an .xsn into its analysis for the model and keeps the file for the import tool', async () => {
    const a = await convertAttachment(fixtureXsn('expense-report'), 'Expense Report.xsn', { vision: false })
    expect(a).toMatchObject({ kind: 'text', mime_type: 'application/vnd.ms-infopath', note: expect.stringMatching(/InfoPath form: 1 view, \d+ fields, 4 of 5 rules convert/) })
    expect(a.text).toContain('# InfoPath import: Expense Report')
    expect(a.infopath?.file_base64.length).toBeGreaterThan(100)
    // Sanitizing keeps it; the stored history drops the bytes.
    const [clean] = sanitizeAttachments([a])
    expect(clean.infopath?.file_base64).toBe(a.infopath!.file_base64)
    expect(attachmentForStorage(clean).infopath).toBeUndefined()
    expect(sanitizeAttachments([{ ...a, infopath: { file_base64: 'not base64 !' } }])[0].infopath).toBeUndefined()
  })

  it('refuses an unreadable template with the reason', async () => {
    await expect(convertAttachment(Buffer.from('MSCF but not really'), 'x.xsn', { vision: false })).rejects.toThrow()
  })

  it('offers import_infopath_form only with an attached template and forms.edit, with a confirmation card', async () => {
    const a = await convertAttachment(fixtureXsn('leave-request'), 'Leave Request.xsn', { vision: false })
    const messages = [{ role: 'user', content: 'here', attachments: [a] }]
    expect(infopathTools(ctx(['forms.view', 'forms.edit']), [{ role: 'user', content: 'hi' }])).toEqual([])
    expect(infopathTools(ctx(['forms.view']), messages)).toEqual([])
    const [tool] = infopathTools(ctx(['forms.view', 'forms.edit']), messages)
    expect(tool).toMatchObject({ name: INFOPATH_TOOL, mode: 'write' })
    const card = await tool.confirm!({ file_name: 'Leave Request.xsn' })
    expect(card.title).toBe('Import the InfoPath form "Leave Request.xsn"')
    expect(card.lines.slice(0, 2)).toEqual([expect.stringMatching(/^Create the form "Leave Request — Leave request"/), expect.stringMatching(/^Create the form "Leave Request — Manager approval"/)])
    const combined = await tool.confirm!({ mode: 'combined' })
    expect(combined.lines[0]).toMatch(/^Create the form "Leave Request"/)
  })
})
