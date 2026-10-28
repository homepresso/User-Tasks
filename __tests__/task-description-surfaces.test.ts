import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { createMcpServer } from '@/lib/mcp/server'
import { GET as listRoute } from '@/app/api/v1/tasks/route'
import { GET as assignedRoute } from '@/app/api/v1/tasks/assigned/route'
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/v1/tasks/[id]/route'
import { POST as ingestRoute } from '@/app/api/v1/tasks/ingest/route'
import { TaskDescription, TaskDescriptionEditor, taskDescriptionExcerpt } from '@/components/tasks/task-description'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows / JSON payloads */

const HTML = '<p>Ship <strong>today</strong> &amp; invoice</p><ul><li>One</li></ul>'

function seed() {
  return createMemorySupabase({
    tasks: [
      { id: 'task-a', tenant_id: 'tenant-a', title: 'Review', description: HTML, status: 'todo', priority: 'medium', is_workflow_task: true, assignee_id: 'user-1', created_at: '2026-10-01', deleted_at: null, metadata: {} },
      { id: 'task-b', tenant_id: 'tenant-a', title: 'Plain', description: 'Fish & chips', status: 'todo', priority: 'low', is_workflow_task: true, assignee_id: 'user-1', created_at: '2026-10-02', deleted_at: null, metadata: {} },
    ],
    task_responses: [],
    lifecycle_events: [],
  })
}
type Db = ReturnType<typeof seed>

const mockedValidate = vi.mocked(validateApiKey)
function authAs(db: Db, permissions: string[]) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}
const req = (path: string, init?: { method?: string; body?: unknown }) => new NextRequest(`https://app.test/api/v1${path}`, {
  method: init?.method ?? 'GET',
  headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
  body: init?.body === undefined ? undefined : JSON.stringify(init.body),
})
const params = (p: { id: string }) => ({ params: Promise.resolve(p) })
const json = async (res: Response) => (await res.json()) as any

beforeEach(() => mockedValidate.mockReset())

describe('REST: task descriptions', () => {
  it('returns description as stored plus description_text; strip_html=true replaces description', async () => {
    const db = seed()
    authAs(db, ['tasks.view_all'])
    const list = await json(await listRoute(req('/tasks')))
    const a = list.data.tasks.find((t: any) => t.id === 'task-a')
    expect(a).toMatchObject({ description: HTML, description_text: 'Ship today & invoice\n- One' })
    expect(list.data.tasks.find((t: any) => t.id === 'task-b')).toMatchObject({ description: 'Fish & chips', description_text: 'Fish & chips' })

    const stripped = await json(await listRoute(req('/tasks?strip_html=true')))
    expect(stripped.data.tasks.find((t: any) => t.id === 'task-a').description).toBe('Ship today & invoice\n- One')

    const assigned = await json(await assignedRoute(req('/tasks/assigned?strip_html=true')))
    expect(assigned.data.tasks.find((t: any) => t.id === 'task-a').description).toBe('Ship today & invoice\n- One')

    const one = await json(await getRoute(req('/tasks/task-a'), params({ id: 'task-a' })))
    expect(one.data.task).toMatchObject({ description: HTML, description_text: 'Ship today & invoice\n- One' })
    const oneText = await json(await getRoute(req('/tasks/task-a?strip_html=true'), params({ id: 'task-a' })))
    expect(oneText.data.task.description).toBe('Ship today & invoice\n- One')
  })

  it('sanitises descriptions on PATCH and ingest', async () => {
    const db = seed()
    authAs(db, ['tasks.complete'])
    const patched = await json(await patchRoute(req('/tasks/task-a', { method: 'PATCH', body: { description: '<p onclick="x">Hi <a href="javascript:alert(1)">there</a></p><script>alert(1)</script>' } }), params({ id: 'task-a' })))
    expect(patched.data.task.description).toBe('<p>Hi <a rel="noopener noreferrer" target="_blank">there</a></p>')
    expect(patched.data.task.description_text).toBe('Hi there')

    authAs(db, ['tasks.create'])
    const res = await ingestRoute(req('/tasks/ingest', { method: 'POST', body: {
      title: 'From ERP', description: '<h2>PO</h2><img src=x onerror=alert(1)>',
      subtasks: [{ title: 'Sub', description: '<b>ok</b><iframe src="https://evil.example"></iframe>' }],
    } }))
    expect(res.status).toBe(201)
    const inserted = db.calls.filter((c) => c.table === 'tasks' && c.op === 'insert').map((c) => c.payload as any)
    expect(inserted[0].description).toBe('<h2>PO</h2>')
    expect(inserted[1][0].description).toBe('<b>ok</b>')
  })
})

describe('MCP: task descriptions', () => {
  const server = (db: Db) => createMcpServer({
    tenantId: 'tenant-a', supabase: db as any, actingUserId: null, keyType: 'tenant',
    scopes: { workflow_ids: [], table_ids: [] },
  })
  const parse = (result: any) => JSON.parse(result.content[0].text)

  it('tasks_get adds description_text and honours strip_html', async () => {
    const db = seed()
    expect(parse(await server(db).callTool('tasks_get', { task_id: 'task-a' }))).toMatchObject({ description: HTML, description_text: 'Ship today & invoice\n- One' })
    expect(parse(await server(db).callTool('tasks_get', { task_id: 'task-a', strip_html: true })).description).toBe('Ship today & invoice\n- One')
  })

  it('tasks_create / tasks_update sanitise HTML', async () => {
    const db = seed()
    await server(db).callTool('tasks_create', { title: 'New', description: '<em>x</em><script>alert(1)</script>' })
    await server(db).callTool('tasks_update', { task_id: 'task-b', description: '<p style="x" onmouseover="y">ok</p>' })
    const writes = db.calls.filter((c) => c.table === 'tasks').map((c) => (c.payload as any)?.description)
    expect(writes).toEqual(['<em>x</em>', '<p>ok</p>'])
  })
})

describe('UI: description rendering', () => {
  it('renders formatted, sanitised HTML in the detail view', () => {
    const html = renderToStaticMarkup(createElement(TaskDescription, { value: `${HTML}<img src=x onerror=alert(1)><script>alert(1)</script>` }))
    expect(html).toBe(`<div class="task-description">${HTML}</div>`)
  })

  it('keeps plain-text line breaks and escapes stray markup', () => {
    expect(renderToStaticMarkup(createElement(TaskDescription, { value: 'Line 1\nLine 2 <x' }))).toBe('<div class="task-description">Line 1<br>Line 2 &lt;x</div>')
    expect(renderToStaticMarkup(createElement(TaskDescription, { value: '' }))).toBe('')
  })

  it('lists show a plain-text excerpt', () => {
    expect(taskDescriptionExcerpt(HTML)).toBe('Ship today & invoice\n- One')
    expect(taskDescriptionExcerpt('Fish & chips')).toBe('Fish & chips')
  })

  it('the editor shows the HTML hint and a preview toggle', () => {
    const html = renderToStaticMarkup(createElement(TaskDescriptionEditor, { name: 'description', defaultValue: '<b>x</b>' }))
    expect(html).toContain('name="description"')
    expect(html).toContain('Plain text or HTML')
    expect(html).toContain('Preview')
  })
})
