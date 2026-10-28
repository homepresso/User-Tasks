import { NextRequest, NextResponse } from 'next/server'
import { resolveAgentToolContext } from '@/lib/agent-tool-auth'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const ctx = await resolveAgentToolContext(request, body)
  if ('error' in ctx) return ctx.error

  const { action } = body

  try {
    if (action === 'excel') {
      const { headers, rows, sheet_name } = body
      const xl = await import('@/lib/excel')
      const arrays = [headers, ...(rows ?? [])].map((r: unknown) => (Array.isArray(r) ? r : []))
      const buffer = await xl.workbookToBuffer(xl.buildWorkbook([{ name: sheet_name ?? 'Sheet1', arrays }]))
      return NextResponse.json({ success: true, size: buffer.length, message: `Excel generated with ${rows?.length ?? 0} rows` })
    }

    if (action === 'word') {
      return NextResponse.json({ success: true, message: 'Word document generation requires a template file. Use the workflow doc_word node for full template processing.' })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
