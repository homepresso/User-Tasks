/**
 * components/ui primitives (docs/design/foundations.md): render checks for the
 * states that matter, the legacy prop aliases other directories still use,
 * aria wiring, and source guards (no micro text, no inline theme colours in
 * the new primitives).
 */
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge, CountBadge, StatusPill, Tag, statusLabel, statusTone } from '@/components/ui/badge'
import { Button, buttonVariants, resolveButtonSize, resolveButtonVariant } from '@/components/ui/button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Input, SearchInput } from '@/components/ui/input'
import { Pagination } from '@/components/ui/list-controls'
import { PageHeader } from '@/components/ui/page-header'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select } from '@/components/ui/select'
import { StatCard } from '@/components/ui/stat-card'
import { RunStatusBadge, StatusBadge } from '@/components/ui/status-badge'
import { Switch } from '@/components/ui/switch'
import { TD, TH, TR, Table } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { ToastCard } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const noop = () => {}

describe('Button', () => {
  it('maps the legacy variant and size names', () => {
    expect(resolveButtonVariant('default')).toBe('primary')
    expect(resolveButtonVariant('outline')).toBe('secondary')
    expect(resolveButtonVariant('destructive')).toBe('danger')
    expect(resolveButtonVariant(undefined)).toBe('primary')
    expect(resolveButtonSize('default')).toBe('md')
    expect(buttonVariants({ variant: 'outline' })).toBe(buttonVariants({ variant: 'secondary' }))
    expect(buttonVariants({ variant: 'destructive', size: 'default' })).toBe(buttonVariants({ variant: 'danger', size: 'md' }))
  })

  it('uses the density control height, no press scale, no per-component ring', () => {
    const out = html(h(Button, null, 'Save'))
    expect(out).toContain('var(--ds-control-h)')
    expect(out).not.toMatch(/active:scale|focus-visible:ring/)
  })

  it('loading: spinner, aria-busy, disabled', () => {
    const out = html(h(Button, { loading: true }, 'Save'))
    expect(out).toContain('aria-busy="true"')
    expect(out).toContain('disabled=""')
    expect(out).toContain('animate-spin')
  })

  it('lets a caller height win (tailwind-merge knows the scale)', () => {
    expect(html(h(Button, { className: 'h-6' }, 'x'))).not.toContain('h-[max(var(--ds-control-h)')
    expect(cn('text-ui', 'text-fg')).toBe('text-ui text-fg')
    expect(cn('text-sm', 'text-ui')).toBe('text-ui')
    expect(cn('shadow-elev-1', 'shadow-none')).toBe('shadow-none')
  })

  it('kbd slot', () => {
    expect(html(h(Button, { kbd: '⌘S' }, 'Save'))).toContain('<kbd')
  })
})

describe('IconButton', () => {
  it('requires a label and sets aria-label', () => {
    const out = html(h(IconButton, { label: 'Delete row', icon: h('svg') }))
    expect(out).toContain('aria-label="Delete row"')
  })
})

describe('inputs', () => {
  it('Input stays a plain input without slots; slots add a wrapper', () => {
    expect(html(h(Input, { placeholder: 'x' }))).toMatch(/^<input/)
    expect(html(h(Input, { leading: h('svg') }))).toMatch(/^<div/)
    expect(html(h(Input, { size: 'lg' }))).toContain('h-10')
  })

  it('SearchInput shows a clear button only with a value', () => {
    expect(html(h(SearchInput, { value: '', onValueChange: noop }))).not.toContain('Clear search')
    expect(html(h(SearchInput, { value: 'abc', onValueChange: noop }))).toContain('aria-label="Clear search"')
  })

  it('Select renders options and a placeholder', () => {
    const out = html(h(Select, { placeholder: 'Choose…', options: [{ value: 'a', label: 'A' }] }))
    expect(out).toContain('<option value="">Choose…</option>')
    expect(out).toContain('appearance-none')
  })

  it('Field wires label, description and error to the control', () => {
    const ok = html(h(Field, { label: 'Name', description: 'Help', id: 'n', children: h(Input) }))
    expect(ok).toContain('for="n"')
    expect(ok).toContain('aria-describedby="n-desc"')
    const bad = html(h(Field, { label: 'Name', error: 'Required', id: 'n', children: h(Input) }))
    expect(bad).toContain('aria-invalid="true"')
    expect(bad).toContain('aria-describedby="n-err"')
    expect(bad).not.toContain('Help')
  })

  it('Checkbox and Switch', () => {
    expect(html(h(Checkbox, { label: 'Notify' }))).toContain('type="checkbox"')
    const sw = html(h(Switch, { checked: true, onCheckedChange: noop, 'aria-label': 'Active' }))
    expect(sw).toContain('role="switch"')
    expect(sw).toContain('aria-checked="true"')
  })
})

describe('Card', () => {
  it('is flat; legacy padding when none is given', () => {
    const legacy = html(h(Card, null, 'x'))
    expect(legacy).toContain('p-6')
    expect(legacy).not.toMatch(/shadow|style=/)
    expect(html(h(Card, { padding: 'none' }, 'x'))).toContain('p-0')
    expect(html(h(Card, { variant: 'inset', padding: 'sm' }, 'x'))).toContain('bg-subtle')
    expect(html(h(Card, { padding: 'none' }, h(CardHeader, { title: 'Profile', description: 'd' }), h(CardBody, null, 'b'), h(CardFooter, null, 'f')))).toContain('Profile')
  })
})

describe('badges', () => {
  it('maps statuses to the one tone set', () => {
    expect(statusTone('in_progress')).toBe('info')
    expect(statusTone('failed')).toBe('danger')
    expect(statusTone('awaiting_approval')).toBe('warning')
    expect(statusTone('active')).toBe('success')
    expect(statusTone('migrated')).toBe('brand')
    expect(statusTone('whatever')).toBe('neutral')
    expect(statusLabel('waiting_for_event')).toBe('Waiting for event')
  })

  it('StatusPill / legacy StatusBadge / RunStatusBadge use sentence case and tone classes', () => {
    expect(html(h(StatusPill, { status: 'in_progress' }))).toContain('In progress')
    expect(html(h(StatusBadge, { status: 'todo' }))).toContain('To do')
    const run = html(h(RunStatusBadge, { status: 'failed' }))
    expect(run).toContain('bg-danger-wash')
    expect(run).toContain('Failed')
  })

  it('Badge, Tag, CountBadge, PriorityBadge', () => {
    expect(html(h(Badge, { tone: 'success' }, 'Ok'))).toContain('text-success')
    expect(html(h(Tag, { mono: true }, 'v2'))).toContain('font-mono')
    expect(html(h(CountBadge, { count: 120 }))).toContain('99+')
    const p = html(h(PriorityBadge, { priority: 'critical' }))
    expect(p).toContain('Critical')
    expect(p).toContain('text-danger')
    expect(p).not.toContain('rounded-full')
  })
})

describe('navigation', () => {
  it('Tabs: roles, selection, roving tabindex, count', () => {
    const out = html(h(Tabs, { 'aria-label': 'T', value: 'b', onValueChange: noop, items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', count: 3 }] }))
    expect(out).toContain('role="tablist"')
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(out).toMatch(/aria-selected="true"[^>]*tabindex="0"/)
    expect(out).toContain('whitespace-nowrap')
  })

  it('SegmentedControl is a radiogroup; icon-only options get a name', () => {
    const out = html(h(SegmentedControl, { 'aria-label': 'View', value: 'list', onValueChange: noop, options: [{ value: 'list', label: 'List', icon: h('svg') }, { value: 'grid', text: 'Grid' }] }))
    expect(out).toContain('role="radiogroup"')
    expect(out).toContain('aria-label="List"')
    expect(out).toContain('aria-checked="true"')
  })

  it('PageHeader: breadcrumbs, h1, actions', () => {
    const out = html(h(PageHeader, { title: 'Workflows', breadcrumbs: [{ label: 'Build', href: '/b' }, { label: 'Workflows' }], actions: h(Button, null, 'New') }))
    expect(out).toContain('aria-label="Breadcrumb"')
    expect(out).toContain('aria-current="page"')
    expect(out).toMatch(/<h1[^>]*text-title/)
  })
})

describe('data display', () => {
  it('Table: numeric cells right-aligned with tabular figures, density row height', () => {
    const out = html(h(Table, null, h('tbody', null, h(TR, { selected: true }, h(TD, { numeric: true }, '1,240')))))
    expect(out).toContain('num text-right')
    expect(out).toContain('var(--theme-density-row-height)')
    expect(out).toContain('data-selected="true"')
    expect(html(h('table', null, h('thead', null, h('tr', null, h(TH, null, 'Name')))))).toContain('sticky')
  })

  it('StatCard keeps the legacy accent prop (mapped to a tone, no inline colour)', () => {
    const out = html(h(StatCard, { label: 'Failed', value: '3', accent: 'var(--theme-danger)' }))
    expect(out).toContain('text-danger')
    expect(out).not.toContain('style=')
    expect(out).toContain('num')
  })

  it('EmptyState sizes and variants', () => {
    expect(html(h(EmptyState, { title: 'No forms yet', size: 'sm' }))).toContain('py-6')
    expect(html(h(EmptyState, { title: 'Broken', variant: 'error' }))).toContain('role="alert"')
  })

  it('ProgressBar exposes progress and turns success at 100%', () => {
    const out = html(h(ProgressBar, { value: 100 }))
    expect(out).toContain('role="progressbar"')
    expect(out).toContain('bg-success')
  })

  it('Pagination uses tabular figures', () => {
    expect(html(h(Pagination, { page: 1, pageSize: 10, total: 30, onPageChange: noop }))).toContain('num')
  })
})

describe('feedback', () => {
  it('InlineNotice keeps the legacy tone/message props', () => {
    const out = html(h(InlineNotice, { tone: 'error', message: 'Nope' }))
    expect(out).toContain('role="alert"')
    expect(out).toContain('bg-danger-wash')
    expect(out).toContain('Nope')
  })

  it('ToastCard: status role, alert for errors', () => {
    expect(html(h(ToastCard, { title: 'Saved', tone: 'success' }))).toContain('role="status"')
    expect(html(h(ToastCard, { title: 'Failed', tone: 'danger' }))).toContain('role="alert"')
  })
})

describe('source guards (components/ui)', () => {
  const dir = path.join(__dirname, '..', 'components', 'ui')
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'))

  it('no text below the 11px floor', () => {
    for (const f of files) expect(readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/text-\[(7|8|9|10)px\]/)
  })

  // The design-system primitives take colour from utilities only. (The older
  // pickers / tag manager still carry data-driven colours and a few legacy
  // styles until they are restyled on Input + Popover.)
  const PRIMITIVES = ['avatar', 'badge', 'busy-bar', 'button', 'card', 'confirm-dialog', 'dialog', 'dropdown-menu', 'empty-state', 'field', 'icon-button', 'inline-notice', 'input', 'kbd', 'list-controls', 'page-header', 'popover', 'priority-badge', 'progress-bar', 'segmented-control', 'select', 'sheet', 'skeleton', 'stat-card', 'status-badge', 'switch', 'table', 'tabs', 'textarea', 'toast', 'tooltip']
  it.each(PRIMITIVES)('%s uses no inline colour styles or per-component focus rings', (name) => {
    const src = readFileSync(path.join(dir, `${name}.tsx`), 'utf8')
    expect(src).not.toMatch(/style=\{\{[^}]*(color|background|border)/i)
    expect(src).not.toMatch(/focus-visible:ring/)
    expect(src).not.toMatch(/#[0-9a-f]{6}\b/i)
  })
})
