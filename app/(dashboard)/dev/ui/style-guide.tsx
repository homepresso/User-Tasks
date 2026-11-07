'use client'

import { useState } from 'react'
import { Copy, Download, LayoutGrid, List, MoreHorizontal, Pencil, Plus, Settings, Table2, Trash2, Workflow } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge, CountBadge, StatusPill, Tag } from '@/components/ui/badge'
import { BusyBar } from '@/components/ui/busy-bar'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { Checkbox, Radio } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Input, SearchInput } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Pagination } from '@/components/ui/list-controls'
import { PageHeader } from '@/components/ui/page-header'
import { Popover } from '@/components/ui/popover'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select } from '@/components/ui/select'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { Switch } from '@/components/ui/switch'
import { Table, TBody, TD, TDActions, TH, THead, TR, TableSkeleton } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToastCard } from '@/components/ui/toast'
import { Tooltip } from '@/components/ui/tooltip'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {children}
    </section>
  )
}

const ROWS = [
  { name: 'Invoice approval', status: 'active', runs: 1240, avg: '4.2 s', priority: 'high' },
  { name: 'Vendor onboarding', status: 'draft', runs: 18, avg: '12.7 h', priority: 'medium' },
  { name: 'Expense claims', status: 'failed', runs: 302, avg: '850 ms', priority: 'critical' },
  { name: 'Contract renewal', status: 'paused', runs: 7, avg: '3 d', priority: 'low' },
]

export function StyleGuide() {
  const [tab, setTab] = useState('overview')
  const [range, setRange] = useState('30')
  const [view, setView] = useState('list')
  const [q, setQ] = useState('')
  const [on, setOn] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [page, setPage] = useState(2)
  const [loading, setLoading] = useState(false)

  return (
    <div className="mx-auto max-w-[1080px] space-y-10 pb-16">
      <PageHeader
        breadcrumbs={[{ label: 'Dev', href: '/home' }, { label: 'UI primitives' }]}
        title="UI primitives"
        badge={<StatusPill status="published" />}
        description="The components/ui primitives on the current workspace theme. Switch the theme or your OS light / dark setting to check both modes."
        actions={<>
          <Button variant="secondary" leadingIcon={<Download />}>Export</Button>
          <Button leadingIcon={<Plus />} kbd="N">New workflow</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><IconButton label="More actions" icon={<MoreHorizontal />} variant="secondary" /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Workflow</DropdownMenuLabel>
              <DropdownMenuItem icon={<Pencil />} kbd="R">Rename</DropdownMenuItem>
              <DropdownMenuItem icon={<Copy />} kbd="⌘D">Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 />} danger onSelect={() => setConfirm(true)}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
        tabs={<Tabs aria-label="Sections" value={tab} onValueChange={setTab} items={[
          { value: 'overview', label: 'Overview' },
          { value: 'runs', label: 'Runs', count: 1240 },
          { value: 'settings', label: 'Settings' },
          { value: 'disabled', label: 'Disabled', disabled: true },
        ]} />}
      />

      <Section title="Type scale">
        <Card padding="md" className="space-y-2">
          <p className="text-title">Page title · text-title 22/600</p>
          <p className="text-base font-semibold">Card title · text-base 16/600</p>
          <p className="text-sm">Body · text-sm 14 — descriptions and dialog copy.</p>
          <p className="text-ui">Default UI · text-ui 13 — tables, buttons, menus.</p>
          <p className="text-xs text-fg-muted">Meta · text-xs 12 — timestamps and helper text.</p>
          <p className="text-2xs text-fg-muted">Floor · text-2xs 11 — badges and kbd.</p>
          <p className="num text-metric">1,240.50</p>
          <p className="font-mono text-ui">wf_01HZX9 · {'{{ input.amount }}'}</p>
        </Card>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete form</Button>
          <Button variant="danger-ghost">Remove</Button>
          <Button variant="link">Learn more</Button>
          <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1500) }}>Save changes</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary">Small</Button>
          <Button size="md" variant="secondary">Medium</Button>
          <Button size="lg" variant="secondary">Large</Button>
          <IconButton label="Settings" icon={<Settings />} kbd="⌘," />
          <IconButton label="Copy link" icon={<Copy />} size="sm" />
          <Tooltip content="Search" kbd="⌘K"><Button variant="secondary">Hover me</Button></Tooltip>
          <Kbd>⌘K</Kbd>
        </div>
      </Section>

      <Section title="Inputs">
        <Card padding="md" className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" description="Shown to people who fill in the form.">
            <Input placeholder="Vendor application" />
          </Field>
          <Field label="Email" error="Enter an email address like name@example.com">
            <Input defaultValue="ada@" />
          </Field>
          <Field label="Status" optional>
            <Select options={[{ value: 'a', label: 'Active' }, { value: 'b', label: 'Inactive' }]} />
          </Field>
          <Field label="Search">
            <SearchInput value={q} onValueChange={setQ} kbd="/" />
          </Field>
          <Field label="Notes">
            <Textarea placeholder="Anything reviewers should know" />
          </Field>
          <div className="space-y-3">
            <Checkbox label="Notify the assignee" defaultChecked />
            <Checkbox label="Disabled" disabled />
            <div className="flex gap-4">
              <Radio name="r" label="Daily" defaultChecked />
              <Radio name="r" label="Weekly" />
            </div>
            <Switch checked={on} onCheckedChange={setOn} label="Active" />
            <Input size="sm" placeholder="Small 28px" />
            <Input size="lg" placeholder="Large 40px (form runtime)" />
          </div>
        </Card>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          {['todo', 'in_progress', 'waiting_for_event', 'failed', 'completed', 'migrated'].map((s) => <StatusPill key={s} status={s} />)}
          <Badge tone="info">Info</Badge>
          <Tag>finance</Tag>
          <Tag mono>v2</Tag>
          <CountBadge count={14} />
          <CountBadge count={3} tone="danger" />
          {['critical', 'high', 'medium', 'low'].map((p) => <PriorityBadge key={p} priority={p} />)}
          <Avatar name="Ada Lovelace" />
          <Avatar name="Grace Hopper" size="lg" />
        </div>
      </Section>

      <Section title="Tabs and segmented controls">
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl aria-label="Range" value={range} onValueChange={setRange} options={[{ value: '7', text: '7 days' }, { value: '30', text: '30 days' }, { value: '90', text: '90 days' }]} />
          <SegmentedControl aria-label="View" size="sm" value={view} onValueChange={setView} options={[{ value: 'list', icon: <List />, label: 'List' }, { value: 'grid', icon: <LayoutGrid />, label: 'Grid' }]} />
        </div>
      </Section>

      <Section title="Stat cards">
        <StatGrid>
          <StatCard label="Completed" value="1,240" tone="success" delta={{ label: '+12%', direction: 'up', goodWhen: 'up', caption: 'vs prior 30 days' }} />
          <StatCard label="Median time" value="12.7" unit="h" hint="Start to finish" />
          <StatCard label="Failed" value="3" accent="var(--theme-danger)" />
          <StatCard label="On time" value="76" unit="%" footer={{ label: 'View all', href: '/reports' }} />
        </StatGrid>
      </Section>

      <Section title="Table">
        <Table>
          <THead>
            <tr><TH>Name</TH><TH>Status</TH><TH>Priority</TH><TH numeric>Runs</TH><TH numeric>Avg</TH><TH><span className="sr-only">Actions</span></TH></tr>
          </THead>
          <TBody>
            {ROWS.map((r, i) => (
              <TR key={r.name} interactive selected={i === 1} onClick={() => {}}>
                <TD className="font-medium">{r.name}</TD>
                <TD><StatusPill status={r.status} /></TD>
                <TD><PriorityBadge priority={r.priority} /></TD>
                <TD numeric>{r.runs.toLocaleString('en')}</TD>
                <TD numeric>{r.avg}</TD>
                <TDActions><IconButton size="sm" label="Edit" icon={<Pencil />} /><IconButton size="sm" label="Delete" icon={<Trash2 />} /></TDActions>
              </TR>
            ))}
            <TableSkeleton columns={6} rows={2} />
          </TBody>
        </Table>
        <Pagination page={page} pageSize={25} total={312} onPageChange={setPage} showPageNumbers noun="workflows" />
      </Section>

      <Section title="Cards, notices, empty states">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card padding="none">
            <CardHeader title="Profile" description="Your name and avatar across the workspace." actions={<Button size="sm" variant="secondary">Edit</Button>} />
            <CardBody>
              <Card variant="inset" padding="sm" className="text-ui text-fg-muted">An inset well instead of a nested card.</Card>
            </CardBody>
            <CardFooter><Button size="sm">Save changes</Button></CardFooter>
          </Card>
          <Card variant="interactive" padding="md">
            <p className="text-base font-semibold">Interactive card</p>
            <p className="mt-1 text-ui text-fg-muted">Hover: border-strong and elev-1.</p>
          </Card>
        </div>
        <div className="space-y-2">
          <InlineNotice tone="info" title="4 live instances on older versions" message="They finish on the version they started on." />
          <InlineNotice tone="success" message="Saved." onDismiss={() => {}} />
          <InlineNotice tone="warning" message="This form has no submit button." />
          <InlineNotice tone="error" message="Couldn't reach the server." actions={<Button size="sm" variant="ghost">Retry</Button>} />
        </div>
        <Card padding="none">
          <EmptyState icon={Workflow} title="No workflows yet" description="Workflows automate a process from a trigger to its outcome. Start from a template or a blank canvas." action={{ label: 'Create workflow' }} secondaryAction={{ label: 'Learn more', href: '/docs' }} />
        </Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card padding="none"><EmptyState size="sm" variant="no-results" title="No results for “zzz”" action={{ label: 'Clear filters' }} /></Card>
          <Card padding="none"><EmptyState size="sm" variant="error" title="Couldn't load runs" description="Error ID 8f2c" action={{ label: 'Try again' }} /></Card>
        </div>
      </Section>

      <Section title="Loading and progress">
        <Card padding="md" className="space-y-3">
          <Skeleton className="h-2.5 w-2/3" />
          <Skeleton className="h-2.5 w-1/3" />
          <ProgressBar value={42} label="Upload" />
          <ProgressBar value={100} label="Done" />
          <BusyBar label="Creating workflow…" />
        </Card>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild><Button variant="secondary">Open dialog</Button></DialogTrigger>
            <DialogContent title="Rename form" description="The new name shows in the library and on the form.">
              <DialogBody><Field label="Name"><Input defaultValue="Vendor application" /></Field></DialogBody>
              <DialogFooter><Button variant="secondary">Cancel</Button><Button>Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild><Button variant="secondary" leadingIcon={<Table2 />}>Open sheet</Button></SheetTrigger>
            <SheetContent title="Run details" description="Invoice approval · run 1240">
              <DialogBody><p className="text-ui text-fg-muted">Sheet body.</p></DialogBody>
            </SheetContent>
          </Sheet>
          <Popover trigger={(p) => <Button variant="secondary" size="sm" {...p}>Status: Active</Button>} aria-label="Status filter">
            <div className="space-y-2"><Checkbox label="Active" defaultChecked /><Checkbox label="Inactive" /></div>
          </Popover>
          <Button variant="danger" onClick={() => setConfirm(true)}>Confirm dialog</Button>
          <ConfirmDialog open={confirm} onOpenChange={setConfirm} destructive title="Delete 'Vendor application'?" description="Its 32 submissions are deleted too. This can't be undone." confirmLabel="Delete form" onConfirm={() => setConfirm(false)} />
        </div>
        <div className="flex flex-wrap gap-3">
          <ToastCard tone="success" title="Workflow published" description="Version 3 is live." action={{ label: 'View run', onClick: () => {} }} onDismiss={() => {}} />
          <ToastCard tone="running" title="Exporting 312 rows" />
          <ToastCard tone="danger" title="Import failed" description="Row 14: the date isn't valid." toneBar onDismiss={() => {}} />
        </div>
      </Section>
    </div>
  )
}
