# Design-system foundations: usage guide

Workstream A of the UI polish ([`ui-polish-spec.md`](./ui-polish-spec.md)). This is the
short guide for workstreams B–F: which token or primitive to reach for, and the rules.
The living style guide is **`/dev/ui`** (dev builds only). It renders every primitive on
the current workspace theme. Switch the theme in Settings → Theme, or your OS light/dark
setting, to check both modes.

## 1. Rules in one screen

- **Colour comes from utilities, never `style={{ color: 'var(--theme-…)' }}`.**
  - Text: `text-fg`, `text-fg-muted` or `text-fg-subtle`.
  - Surfaces: `bg-bg`, `bg-panel`, `bg-subtle`, `bg-muted` or `bg-elevated`.
  - Borders: `border-border`, `border-border-subtle` or `border-border-strong`.
  - Brand: `bg-primary`, `text-primary-text` or `bg-primary-wash`.
  - Status: `text-success`, `bg-danger-wash` and so on.
- **No hex literals and no Tailwind palette classes** (`bg-gray-*`, `text-red-*`) in app code.
- **Type:** use the scale (§3). Nothing below 11px (`text-2xs`). No `text-[Npx]`.
- **No uppercase micro-labels.** Use sentence case for buttons, tabs, headers and table
  headers.
- **One `primary` button per page header or dialog footer.**
- **Cards are flat.** Never nest a bordered card inside another card. Use
  `<Card variant="inset">` or a divider instead.
- **Elevation is only for things that float:** menus, popovers, toasts, dialogs and sheets.
- **Focus is global.** Don't add `focus-visible:ring-*`, and never use `outline-none`
  without a replacement.
- **Icons:** Lucide at 16px by default, 14px in sm controls, table cells and meta lines,
  and 20px in empty states and page-header tiles. Stroke is 1.75, set globally.
- **Tooltips:** every icon-only button is an `IconButton`, which brings its own
  `aria-label` and Tooltip. Don't use `title=` on interactive elements.
- **Numbers that stack** (tables, KPIs, counters) get `num` (tabular figures). In tables,
  numbers are right-aligned (`<TD numeric>`).
- **Navigation vs filters:** page views use `Tabs`. Filters and modes use
  `SegmentedControl`.

## 2. Tokens

All tokens are declared in `app/globals.css`. Colour tokens derive from the workspace
theme's `--theme-*` variables, so every theme works in light and dark with no extra code.

### Semantic colours (Tailwind utilities)

| Utility | Token | Use |
|---|---|---|
| `bg-bg` | `--theme-surface` | Page canvas |
| `bg-panel` | `--theme-card-bg` | Cards, tables, inputs on cards |
| `bg-subtle` | card text 4% into the card | Table header, hover row, wells |
| `bg-muted` | card text 7% into the card | Pressed state, selected neutral, skeleton, segmented track |
| `bg-elevated` | card bg (lifted in dark mode) | Menus, popovers, dialogs, toasts |
| `text-fg` / `text-fg-muted` / `text-fg-subtle` | card text / muted / muted 80% | Body / secondary / placeholder and disabled (decorative only) |
| `border-border` / `-subtle` / `-strong` | surface border / 55% / text 24% | Cards and inputs / row dividers / hover and selected |
| `bg-primary`, `text-primary-fg`, `bg-primary-hover` | primary fill | The one primary action, checked controls |
| `text-primary-text`, `bg-primary-wash` | AA brand text / brand wash | Links, the brand badge, selected rows |
| `text-accent-text`, `bg-accent-wash` | accent | Brand moments only |
| `text-success`, `bg-success-wash` (also `warning`, `danger`, `info`) | semantic | Status pills, notices, destructive actions |
| `bg-input`, `border-input-border`, `outline-focus` | input bg / border / focus ring | Custom controls |

### CSS variables (`--ds-*`)

| Variable | Default (comfortable) | Notes |
|---|---|---|
| `--ds-radius-xs/sm/input/md/lg` | badge / button / input / card / dialog radius of the theme | Prefer the `rounded-*` classes below |
| `--ds-border`, `--ds-border-subtle`, `--ds-border-strong`, `--ds-border-focus` | | Hairlines |
| `--ds-bg-subtle`, `--ds-bg-muted`, `--ds-fg-subtle`, `--ds-bg-elevated` | | Neutral fills |
| `--ds-elev-0..3` | light and dark values | Use `shadow-elev-1/2/3` |
| `--ds-dur-instant/fast/base/slow` | 80 / 120 / 180 / 260ms (0 with reduced motion) | `duration-[var(--ds-dur-fast)]` |
| `--ds-ease-out/in/standard` | | `ease-[var(--ds-ease-standard)]` |
| `--ds-control-h`, `-sm`, `-lg` | 32 / 28 / 36px (follow density) | Control heights |
| `--ds-nav-item-h` | 32px | Sidebar items |
| `--ds-touch-min` | 0, or 40px on coarse pointers | `h-[max(var(--ds-control-h),var(--ds-touch-min))]` |
| `--theme-density-row-height`, `--theme-density-cell-x` | 40px / 12px | Table rows and cell padding |

**Scopes.** The derived tokens are declared again on `[data-form-theme]` and
`[data-ds-scope]`, because a custom property's `var()` resolves where it is declared. A
scoped `themeStylesheet(theme, { scope })` (the theme designer preview) re-declares them
itself (`DS_DERIVED_VARS` in `lib/theme/to-css.ts`). Any other element that sets its own
`--theme-*` variables inline must carry `data-ds-scope` (form themes already carry
`data-form-theme`), or `bg-subtle` and the other derived tokens keep the outer theme's
values.

**Theme-driven values.** `lib/theme/to-css.ts` emits, per palette, `--ds-elev-1/2/3` and
`--ds-bg-elevated` (platform light or dark values by canvas darkness; a custom theme's own
shadows replace them on light canvases only), and, per theme density, `--ds-control-h*`,
`--ds-nav-item-h` and the row / cell variables. Custom `shadows.card` no longer reaches
cards (cards are flat).

### Type scale

| Class | Size / line height | Use |
|---|---|---|
| `text-2xs` | 11 / 16 | The floor: badges, kbd, chart ticks |
| `text-xs` | 12 / 16 | Meta, helper text, timestamps, breadcrumbs, table headers |
| `text-ui` | 13 / 20 | **Default UI text:** table cells, menus, buttons, tabs, inputs |
| `text-sm` | 14 / 20 | Body copy, descriptions, dialog body |
| `text-base` + `font-semibold` | 16 / 24 | Card, section and dialog titles |
| `text-lg` + `font-semibold` | 18 | Sub-page and sheet titles |
| `text-title` | 22 / 28, 600 | Page h1, one per page (PageHeader renders it) |
| `text-metric` | 28 / 34, 600 | KPI values (add `num`) |
| `text-display` | clamp 36–60 | Marketing heroes only, with `font-display` (Fraunces) |

Weights are 400, 500 and 600. `font-bold` is not used in the app. Fonts are Inter
(`font-sans`), JetBrains Mono (`font-mono`) and Fraunces (`font-display`, public brand
pages only). A workspace theme's own font always wins.

**Codemod for owned files:** `text-[7|8|9|10|11px]` → `text-2xs`, `text-[12px]` →
`text-xs`, `text-[13px]` → `text-ui`, and `text-[15px]` → `text-sm` or `text-base`
depending on role. Then drop any `uppercase tracking-wider` on the same element.

### Radius, elevation and motion

- **Radius:**
  - `rounded` and `rounded-sm` use the badge radius.
  - `rounded-md` uses the button and input radius.
  - `rounded-lg` uses the card radius.
  - `rounded-xl` and `rounded-2xl` use the dialog radius.
  - `rounded-full` is for pills and avatars.
  - The radii come from the theme's `shape.*` values. The old global flattening
    (`rounded-lg` = `rounded-xl`) is gone.
- **Elevation:**
  - `shadow-elev-1`: segmented thumb, hovered interactive card, primary button.
  - `shadow-elev-2`: menus, popovers, tooltips, toasts.
  - `shadow-elev-3`: dialogs and sheets.
  - The dark values are mode-aware, so don't hand-roll `shadow-lg`.
- **Motion classes in `globals.css`:**
  - `ds-pop`: menu and popover enter, keyed off Radix `data-state`.
  - `ds-overlay`, `ds-dialog`, `ds-sheet` and `ds-toast`.
  - `ds-skeleton`: a real shimmer.
  - `ds-scroll-fade-x`: faded edges on horizontal scrollers.
  - All of these honour `prefers-reduced-motion`.
- **Utilities:** `num` (tabular figures) and `scrollbar-thin`.

### LEGACY COMPAT block

`globals.css` still remaps raw palette classes onto the theme: `bg-white`, `text-gray-*`,
`border-gray-*`, the teal, red, green and amber shades, plus `rounded-lg` on raw
buttons and inputs. The block is fenced as `LEGACY COMPAT — remove when B–F land`.

- Don't rely on it in new code.
- When your directory no longer uses those classes, tell A, and A deletes the block in
  the final cleanup.
- The `abyss-auth` and `docs-abyss` overrides go the same way once auth and docs use
  tokens (B and F).

## 3. Primitives (`components/ui`)

Every primitive keeps its old exports and props, so existing callers compile unchanged.
The aliases are listed under each one and will be removed in the final cleanup.

### Button, IconButton and Kbd

```tsx
<Button>Save changes</Button>                                   // primary (one per region)
<Button variant="secondary" leadingIcon={<Download />}>Export</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button variant="danger" loading={busy}>Delete form</Button>   // loading: spinner + aria-busy + disabled
<Button variant="link">Learn more</Button>
<Button kbd="⌘S">Save</Button>
<Button asChild variant="secondary"><Link href="/x">Open</Link></Button>
<IconButton label="Delete row" icon={<Trash2 />} size="sm" />   // aria-label + Tooltip, ghost by default
```

- **Variants:** `primary`, `secondary`, `ghost`, `danger`, `danger-ghost` and `link`.
- **Sizes:** `sm` (28px), `md` (32px, follows density), `lg` (36px), and the square sizes
  `icon-sm`, `icon` and `icon-lg`.
- **Aliases:** `default` → primary, `outline` → secondary, `destructive` → danger, and
  size `default` → md.
- `buttonVariants({ variant, size })` returns the class string, for elements that can't be
  a `<Button>`.
- Don't put `!bg-red-600`-style overrides on Button. Use a variant.

### Inputs

```tsx
<Field label="Email" description="We never share it." error={err} optional>
  <Input type="email" value={v} onChange={…} />
</Field>
<Input size="sm" leading={<Search />} trailing={<Kbd>/</Kbd>} />
<SearchInput value={q} onValueChange={setQ} kbd="/" />        // clear button, Esc clears
<Select options={[{ value: 'a', label: 'Active' }]} placeholder="Choose…" />   // styled native select
<Textarea rows={4} />
<Checkbox label="Notify" description="…" />  <Radio name="r" label="Daily" />
<Switch checked={on} onCheckedChange={setOn} label="Active" />  // or aria-label
```

- **Field** wires `htmlFor`, `aria-describedby` and `aria-invalid` onto its single child.
  In the app chrome, mark optional fields with `optional` and no asterisk. The form
  runtime keeps `required` with its asterisk.
- **Input size:** `size` is now `sm`, `md` or `lg` (lg is 40px, for the form runtime). The
  native `size` attribute moved to `htmlSize`.
- `controlClass` and `CONTROL_HEIGHT` (exported from `input.tsx`) give custom triggers,
  such as pickers, the same look.
- Invalid fields come from `aria-invalid`. Don't colour borders by hand.

### Card

```tsx
<Card padding="none">
  <CardHeader title="Profile" description="…" actions={<Button size="sm" variant="secondary">Edit</Button>} />
  <CardBody>…</CardBody>
  <CardFooter><Button size="sm">Save</Button></CardFooter>
</Card>
<Card padding="md">simple box</Card>
<Card variant="interactive" padding="md">whole-card link</Card>
<Card variant="inset" padding="sm">well inside a card</Card>
```

- If you omit `padding`, you get the **legacy 24px** padding. New code always passes
  `padding` (`none`, `sm` 12px, `md` 16px or `lg` 20px).

### Badges

```tsx
<StatusPill status="in_progress" />          // dot + "In progress", tone from STATUS_TONE
<Badge tone="warning">Due soon</Badge>        // tones: neutral info success warning danger brand
<Tag>finance</Tag>  <Tag mono>v2</Tag>
<CountBadge count={14} />                    // neutral; tone="danger" only for overdue/failed
<PriorityBadge priority="high" />            // signal icon + label, not a pill
```

- **Status mapping** (`statusTone()`):
  - neutral: todo, draft, cancelled, inactive.
  - info: in_progress, running, processing.
  - warning: waiting_for_event, awaiting_approval, paused.
  - danger: blocked, failed.
  - success: completed, active, published.
  - brand: migrated.
- **Active things** (workflows, integrations, agents) are `success`. Don't use emerald.
- **Kept exports:** `StatusBadge`, `RunStatusBadge` and `PriorityBadge`.

### Tabs and SegmentedControl

```tsx
<Tabs aria-label="Table" value={tab} onValueChange={setTab}
      items={[{ value: 'rows', label: 'Rows', count: 32 }, { value: 'schema', label: 'Schema' }]} />
<SegmentedControl aria-label="Range" value={r} onValueChange={setR}
      options={[{ value: '7', text: '7 days' }, { value: '30', text: '30 days' }]} />
<SegmentedControl aria-label="View" size="sm" value={v} onValueChange={setV}
      options={[{ value: 'list', icon: <List />, label: 'List' }, { value: 'grid', icon: <LayoutGrid />, label: 'Grid' }]} />
```

- **Tabs:**
  - Roving tabindex with arrow, Home and End keys.
  - Labels never wrap; the row scrolls instead.
  - `href` items render links. Pass `linkAs={Link}` to use Next's Link.
  - Use `TabPanel idBase=…` for the panel wiring.
- **SegmentedControl:**
  - Options without text need a `label`, which becomes the aria-label and tooltip.

### Table

```tsx
<Table>
  <THead><tr><TH>Name</TH><TH>Status</TH><TH numeric>Runs</TH><TH /></tr></THead>
  <TBody>
    {loading ? <TableSkeleton columns={4} /> : rows.length === 0 ? <TableEmpty colSpan={4} title="No runs yet" /> :
      rows.map((r) => (
        <TR key={r.id} interactive selected={r.id === sel} onClick={() => open(r)}>
          <TD className="font-medium">{r.name}</TD>
          <TD><StatusPill status={r.status} /></TD>
          <TD numeric>{formatCount(r.runs)}</TD>
          <TDActions><IconButton size="sm" label="Edit" icon={<Pencil />} /></TDActions>
        </TR>))}
  </TBody>
</Table>
```

- **Header:** 32px, sticky, subtle background, 12px/500 muted text.
- **Rows:**
  - Height is `--theme-density-row-height`, so the theme designer's density setting
    changes it.
  - No zebra striping.
  - Hover shows the subtle background. Selected shows the primary wash with a 2px bar.
  - `interactive` rows are focusable, and Enter clicks them.
- **Row actions:** `TDActions` reveals its actions on row hover or focus. They are always
  visible on touch.
- Data grids that keep their own markup can use the exported `thClass`, `tdClass` and
  `trClass`.
- **Bare tables:** inside a Card, pass `bare` to drop the table's own border.

### StatCard and StatGrid

```tsx
<StatGrid>
  <StatCard label="Completed" value="1,240" tone="success"
    delta={{ label: '+12%', direction: 'up', goodWhen: 'up', caption: 'vs prior 30 days' }} />
  <StatCard label="Median time" value="12.7" unit="h" hint="Start to finish" footer={{ label: 'View all', href: '/reports' }} />
</StatGrid>
```

- **StatGrid** auto-fits 200px columns, with at most 4 per row from 1280px, so there are
  no orphan rows.
- **Legacy `accent`** (a CSS variable) is mapped to a `tone`.
- Pass a sparkline as `children` (32px tall).

### EmptyState

```tsx
<EmptyState icon={FileText} title="No forms yet" description="Forms collect … Start from a template."
  action={{ label: 'Create form', onClick }} secondaryAction={{ label: 'Learn more', href: '/docs/forms' }} />
<EmptyState size="sm" variant="no-results" title={`No results for “${q}”`} action={{ label: 'Clear filters', onClick }} />
<EmptyState variant="error" title="Couldn't load runs" action={{ label: 'Try again', onClick: reset }} />
```

- **Sizes:** `sm` for tables and panels, `md` by default, `lg` for first-run pages.
- **Copy:** the title states the situation. Never write "No data available".

### Skeleton

- `<Skeleton className="h-2.5 w-2/3" />` draws a shimmer bar.
- `useDelayedFlag(isLoading)` and `<Delayed>` show skeletons only after 150ms, so fast
  loads don't flash.
- The `page-skeleton.tsx` compositions (`PageSkeleton`, `ListSkeleton` and the rest) now
  use Skeleton. `PageSkeleton` waits 150ms before it appears.

### Dialog, Sheet and ConfirmDialog

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent size="md" title="Rename form" description="…">   {/* sm 400 · md 560 · lg 720 · xl 960 · full */}
    <DialogBody>…</DialogBody>
    <DialogFooter><Button variant="secondary">Cancel</Button><Button>Save</Button></DialogFooter>
  </DialogContent>
</Dialog>
<Sheet><SheetTrigger asChild>…</SheetTrigger><SheetContent title="Run details" size="lg">…</SheetContent></Sheet>
<ConfirmDialog open destructive title="Delete 'Vendor application'?" description="Its 32 submissions are deleted too."
  confirmLabel="Delete form" busy={busy} onConfirm={…} onOpenChange={…} />
```

- Replace hand-rolled `fixed inset-0` modals with these.
- Footer buttons are right-aligned: secondary, then primary. The destructive button
  carries the verb.

### DropdownMenu, Popover and Tooltip

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild><IconButton label="More" icon={<MoreHorizontal />} /></DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLabel>Workflow</DropdownMenuLabel>
    <DropdownMenuItem icon={<Copy />} kbd="⌘D" onSelect={dup}>Duplicate</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem danger icon={<Trash2 />}>Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
<Popover trigger={(p) => <Button variant="secondary" size="sm" {...p}>Status: Active</Button>}>…checkboxes…</Popover>
<Tooltip content="Search" kbd="⌘K"><button …/></Tooltip>
```

- **DropdownMenu** also exports `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem` and
  `DropdownMenuSub*`.
- **Popover** is built on `FloatingLayer`, because `@radix-ui/react-popover` isn't
  installed. It closes on an outside click or Escape.
- **Tooltip** carries its own provider, so it works without setup. Wrap a toolbar in
  `TooltipProvider` if you want the tooltips to share one.
- **Shared classes** for custom floating panels: `floatingSurfaceClass` and
  `menuItemClass`.

### Toast, InlineNotice, ProgressBar, BusyBar, Avatar and list controls

- **ToastCard** and **ToastViewport** are presentational. Workstream B wires them into
  the jobs provider, which owns the timers, the stacking and the maximum of 3 visible.
  - Tones: `info`, `success`, `warning`, `danger` and `running`.
  - Props: `action` and `onDismiss`.
- **InlineNotice:**
  - Tones: `neutral`, `info`, `success`, `warning` and `danger`, plus the legacy `error`.
  - Props: `title`, `message` or children, `actions`, `onDismiss` and `banner`.
  - Text stays `fg`; the icon carries the tone.
  - Marketing prompts such as the MCP banner are not notices.
- **ProgressBar** takes `value`, `size` (`md` 6px or `sm` 4px) and `label`. The fill is
  primary, and turns success at 100%.
- **BusyBar** is unchanged in its API; it now uses the muted track.
- **Avatar** takes `name`, `src`, `size` (`sm` 24, `md` 28 or `lg` 32) and `ring`.
  Initials sit on a chart hue derived from the name.
- **SearchBar, FilterChips, Pagination and useListControls** keep the same props.
  SearchBar is now built on SearchInput, and Pagination uses tabular figures.

### PageHeader

```tsx
<PageHeader
  breadcrumbs={[{ label: 'Workflows', href: '/automations' }, { label: wf.name }]}
  title={wf.name} badge={<StatusPill status={wf.status} />}
  description="…"
  actions={<><Button variant="secondary">Test</Button><Button>Publish</Button><MoreMenu /></>}
  tabs={<Tabs … />} icon={<Table2 />} sticky />
```

- Show at most three visible actions. Put the rest in a `⋯` DropdownMenu.
- Breadcrumbs replace back arrows.
- `icon` is only for object detail pages.
- `sticky` adds a blurred background and a hairline once the page is scrolled.

### Formatting (`lib/format/*`)

| Helper | Output |
|---|---|
| `formatCount(n)`, `formatCompact(n)` | `1,234`, `1.2K` |
| `formatPercent(ratio)` | `76%` (0 dp ≥ 10%), `4.2%` (1 dp below); `{ fromPercent: true }` for 0–100 |
| `formatCurrency(amount, code)` | `US$1,234.50` in the record's currency |
| `formatBytes(n)` | `12.4 KB` |
| `formatDurationMs(ms)` / `formatDurationSeconds(s)` / `formatDurationDelta(ms)` | `12 ms`, `4.2 s`, `3 m 10 s`, `12.7 h`, `3 d`; `−2 ms` |
| `plural(n, 'run')`, `pluralWord(n, 'run')` | `1 run`, `3 runs`; pass the plural for irregular nouns |
| `formatRelative(d)` | `5 min ago`, `Yesterday`, `3 days ago`, then `27 Oct` / `27 Oct 2025` |
| `formatAbsolute(d)` | `Tue 27 Oct 2026, 14:05 NZDT` — put it in the Tooltip of a relative date |
| `formatDate`, `formatDay`, `formatDateTime`, `formatTime` | `27 Oct 2026`, `27 Oct`, `27 Oct 2026, 14:05`, `14:05` |

All take `{ locale, timeZone }` (dates also `now`); the default locale is `en-GB`. Never
call `toLocaleString()` raw. `lib/format.ts`'s compact `formatDuration` (`12.4s`) stays
for the report views until they move.

### Lint

`eslint.config.mjs` warns (not errors yet) on arbitrary `text-[Npx]` sizes and raw
6-digit hex colours in `className`, `cn()` / `clsx()` and `style` in `app/` and
`components/`. Marketing, gallery and docs only get the text-size rule. Run
`npx eslint <your dir>` before a PR; the final cleanup turns both into errors.

## 4. Not yet migrated inside `components/ui`

The older pickers still carry some inline styles: `autocomplete-select`,
`date-time-picker`, `searchable-*-picker` and `tag-manager`. Their simple theme-colour
styles became utilities, and their micro text was raised to `text-2xs`. Two kinds of
inline style remain:

- Data-driven colours, such as tag and organisation colours. These are legitimate.
- A few multi-property style objects. These go when the triggers are restyled on
  `controlClass` and the panels on `floatingSurfaceClass`.

If you need a change in `components/ui`, ask A. B–F only consume this directory.
