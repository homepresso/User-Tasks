import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as xl from '@/lib/excel'

/** POST /api/reports/export: server-built .xlsx for report tables (session + reports.view). */

const state = { user: { id: 'u-1' } as { id: string } | null, perms: new Set(['reports.view']) }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
  getCachedUser: async () => state.user,
}))
vi.mock('@/lib/permissions-server', () => ({ getUserPermissions: async () => state.perms }))

import { POST } from '@/app/api/reports/export/route'

const post = (body: unknown) => POST(new NextRequest('https://app.test/api/reports/export', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))

beforeEach(() => {
  state.user = { id: 'u-1' }
  state.perms = new Set(['reports.view'])
})

describe('report export route', () => {
  it('returns an xlsx with the posted columns and rows', async () => {
    const res = await post({ filename: 'Tasks / Q3', columns: ['Title', 'Count', 'Meta'], rows: [['A', 3, { x: 1 }], ['B', null, true]] })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Tasks  Q3.xlsx"')
    const book = await xl.loadWorkbook(await res.arrayBuffer())
    expect(xl.sheetNames(book)).toEqual(['Report'])
    const rows = xl.sheetToArrays(xl.getSheet(book, 'Report')!, { defval: '' })
    expect(rows).toEqual([['Title', 'Count', 'Meta'], ['A', 3, '{"x":1}'], ['B', '', true]])
  })

  it('requires a signed-in user with reports.view', async () => {
    state.user = null
    expect((await post({ columns: ['A'], rows: [] })).status).toBe(401)
    state.user = { id: 'u-1' }
    state.perms = new Set()
    expect((await post({ columns: ['A'], rows: [] })).status).toBe(403)
  })

  it('rejects malformed payloads', async () => {
    expect((await post({ columns: [], rows: [] })).status).toBe(400)
    expect((await post({ columns: ['A'] })).status).toBe(400)
  })
})
