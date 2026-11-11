/**
 * Timeline UI (components/timeline/run-timeline.tsx) renders from a seeded
 * query: header summary, filter chips, day groups as lists with <time>
 * elements, outcome badges, comment bubbles, the collapsed automatic steps
 * (aria-expanded, hidden children), the "Now" line, and Recent activity.
 * Plus the surfaces: REST endpoints, MCP tools and the parity matrix carry
 * both timeline operations, on the same service.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RunTimeline as RunTimelineData } from '@/lib/run-timeline'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/server-read', () => ({ serverRead: vi.fn(async () => ({ data: null, error: { message: 'no', status: 500 } })) }))

import { RecentActivity, RunTimeline, timelineQueryKey } from '@/components/timeline/run-timeline'

const now = new Date()
const iso = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000).toISOString()
const P = (id: string, name: string) => ({ id, name, avatar_url: null })

const data: RunTimelineData = {
  kind: 'run', run_id: 'r1', task_id: null, focus_task_id: null, detail: 'full', live: true,
  links: { process: '/automations/runs/r1', timeline: '/timeline/r1', task: null },
  header: {
    workflow: { id: 'wf', name: 'Purchase request approval' }, title: 'PR-1042 · Laptop', reference: 'PR-1042', status: 'waiting', status_label: 'Waiting for people',
    started_at: iso(120), ended_at: null, duration_ms: 7_200_000, started_by: P('j', 'James Patel'), started_how: 'Purchase request submitted by James Patel',
    current: 'Waiting for Finn Finance — Finance approval', version: 3, sla_due_at: null,
  },
  events: [
    { id: 's', kind: 'started', category: 'decisions', at: iso(120), actor: P('j', 'James Patel'), icon: 'form', tone: 'brand', title: 'Purchase request submitted by James Patel', body: 'Reference PR-1042', submission: { id: 'sub', form_id: 'f', form_name: 'Purchase request' } },
    { id: 'g', kind: 'system_group', category: 'system', at: iso(120), actor: null, icon: 'cog', tone: 'neutral', title: '2 automatic steps', children: [
      { id: 'g1', kind: 'system', category: 'system', at: iso(120), actor: null, icon: 'cog', tone: 'neutral', title: 'Set title' },
      { id: 'g2', kind: 'system', category: 'system', at: iso(120), actor: null, icon: 'branch', tone: 'neutral', title: 'Decision: Over 20000? → No' },
    ] },
    { id: 'c', kind: 'comment', category: 'comments', at: iso(90), actor: P('p', 'Priya Shah'), icon: 'message', tone: 'brand', title: 'Priya Shah commented', body: 'Looks fine', step: 'Manager approval', since_previous_ms: 30 * 60_000 },
    { id: 'o', kind: 'outcome', category: 'decisions', at: iso(60), actor: P('a', 'Ada Admin'), on_behalf_of: P('f', 'Finn Finance'), via: 'the Agent', icon: 'check', tone: 'success', title: 'Approved by Ada Admin', step: 'Manager approval', badge: { label: 'Approve', tone: 'success' }, note: 'Finn is away', body: 'Within budget', fields: [{ label: 'PO number', value: 'PO-77' }], links: [{ kind: 'form', label: 'View form', href: '/tasks/t1?tab=form' }] },
    { id: 'n', kind: 'now', category: 'people', at: iso(59), actor: null, icon: 'hourglass', tone: 'warning', highlight: true, title: 'Waiting for Finn Finance', step: 'Finance approval', body: 'For 59 m so far' },
  ],
}

function render(el: any) {
  const client = new QueryClient()
  client.setQueryData(timelineQueryKey({ runId: 'r1' }), data)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, el))
}

describe('RunTimeline render', () => {
  const out = render(createElement(RunTimeline, { target: { runId: 'r1' } }))

  it('shows the header summary', () => {
    expect(out).toContain('data-timeline-header')
    expect(out).toContain('PR-1042 · Laptop')
    expect(out).toContain('Waiting for people')
    expect(out).toContain('James Patel')
    expect(out).toContain('Now: </span>Waiting for Finn Finance — Finance approval')
    expect(out).toContain('href="/automations/runs/r1"')
    expect(out).toContain('Copy as text')
  })

  it('has the filter chips as pressed buttons', () => {
    for (const label of ['All', 'Approvals &amp; decisions', 'Comments', 'People &amp; assignments', 'System']) expect(out).toContain(label)
    expect(out).toContain('aria-pressed="true"')
  })

  it('renders a day-grouped list with time elements', () => {
    expect(out).toMatch(/<ol[^>]*aria-label="(Today|Yesterday)"/)
    expect(out).toMatch(/<time datetime="[^"]+"/i)
    expect((out.match(/data-timeline-event=/g) ?? []).length).toBe(7)
  })

  it('shows outcome badges, on behalf, via, note, fields and the comment bubble', () => {
    expect(out).toContain('data-timeline-outcome')
    expect(out).toContain('Approve')
    expect(out).toContain('on behalf of Finn Finance')
    expect(out).toContain('via the Agent')
    expect(out).toContain('Reason: Finn is away')
    expect(out).toContain('PO-77')
    expect(out).toContain('data-timeline-comment')
    expect(out).toContain('Looks fine')
    expect(out).toContain('30 m later')
    expect(out).toContain('View submission')
  })

  it('collapses the automatic steps behind an aria-expanded button', () => {
    expect(out).toContain('aria-expanded="false"')
    expect(out).toMatch(/<ol id="tl-children-g" hidden=""/)
    expect(out).toContain('2 automatic steps')
  })

  it('highlights the Now line', () => {
    expect(out).toContain('data-timeline-event="now"')
    expect(out).toContain('Now:</span>Waiting for Finn Finance')
  })

  it('Recent activity shows the last human events, newest first', () => {
    const recent = render(createElement(RecentActivity, { target: { runId: 'r1' }, onOpen: () => {} }))
    expect(recent).toContain('View full timeline')
    const order = ['Waiting for Finn Finance', 'Approved by Ada Admin', 'Priya Shah commented'].map((t) => recent.indexOf(t))
    expect(order.every((i) => i > 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(recent).not.toContain('automatic steps')
  })
})

describe('timeline surfaces (REST / MCP parity)', () => {
  it('registers both REST endpoints on the same service', async () => {
    const { API_ENDPOINTS } = await import('@/lib/api-schemas')
    const run = API_ENDPOINTS.find((e) => e.path === '/workflows/runs/{id}/timeline')
    const task = API_ENDPOINTS.find((e) => e.path === '/tasks/{id}/timeline')
    expect(run).toMatchObject({ method: 'GET', permission: null, cli: { resource: 'runs', verb: 'timeline' } })
    expect(task).toMatchObject({ method: 'GET', permission: null, cli: { resource: 'tasks', verb: 'timeline' } })
    expect(readFileSync('app/api/v1/workflows/runs/[id]/timeline/route.ts', 'utf8')).toContain('getRunTimeline(ctx, params.id)')
    expect(readFileSync('app/api/v1/tasks/[id]/timeline/route.ts', 'utf8')).toContain('getTaskTimeline(ctx, params.id)')
    expect(readFileSync('lib/mcp/tools/timeline.ts', 'utf8')).toMatch(/getRunTimeline\(svc\(\), args\.run_id\)[\s\S]*getTaskTimeline\(svc\(\), args\.task_id\)/)
  })

  it('registers both MCP tools, gated as reads', async () => {
    const { createMcpServer } = await import('@/lib/mcp/server')
    const { buildMcpInfoPayload } = await import('@/lib/mcp/metadata')
    const { READ_TOOL_PERMISSIONS } = await import('@/lib/mcp/authz')
    const server = createMcpServer({ tenantId: 't', supabase: {}, actingUserId: 'u', keyType: 'user', scopes: { workflow_ids: [], table_ids: [] } } as any)
    const names = buildMcpInfoPayload(server).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['workflows_run_timeline', 'tasks_timeline']))
    expect(READ_TOOL_PERMISSIONS.workflows_run_timeline).toBe('tasks.view_own')
    expect(READ_TOOL_PERMISSIONS.tasks_timeline).toBe('tasks.view_own')
  })

  it('lists them in the parity matrix', async () => {
    const { SURFACE_PARITY } = await import('@/lib/surface-parity')
    const ops = SURFACE_PARITY.find((r) => r.resource.startsWith('timelines'))!.ops
    expect(ops.find((o) => o.rest === 'GET /workflows/runs/{id}/timeline')?.mcp).toBe('workflows_run_timeline')
    expect(ops.find((o) => o.rest === 'GET /tasks/{id}/timeline')?.mcp).toBe('tasks_timeline')
  })
})
