# UI polish spec: from "boilerplate" to enterprise-grade

Status: **design spec, ready for implementation** (audit of `main` at release-dec5, 2026-11-04).
Screenshots are listed in [`ui-audit-screens.md`](./ui-audit-screens.md). File names such as
`03-tasks-list--light.png` refer to that set.

The user gave design control, fonts included. This document therefore makes decisions instead of
listing options. Each decision has a one-line rationale. Anything that changes how existing workspace
themes, form themes or docs screenshots look is flagged **[migration]**, and §9 collects those notes.

---

## 0. Summary

The product is feature-rich and mostly themed correctly. It feels boilerplate because **there is no
design system between the theme tokens and the pages**. `components/ui` has 22 files but lacks the
primitives every page needs: dialog, tabs, table, select, badge, tooltip, menu and page header. So
547 TSX files each re-invent them with raw Tailwind defaults. `app/globals.css` then bends those
defaults back toward the theme with roughly 120 lines of `!important` attribute-selector overrides. As
a result:

- Every surface has its own type sizes, radii, paddings, headers, tabs and badge styles.
- Nothing has a deliberate hierarchy: one radius, one shadow and two font sizes everywhere.

The fix is in this order:

1. Real tokens: type, space, radius, border, elevation, motion and focus.
2. Twelve to fifteen primitives that use those tokens.
3. Page-by-page adoption, with the global overrides removed as pages migrate.

### Measured baseline (`app/` + `components/`, 547 TSX files)

| Signal | Count | Notes |
|---|---|---|
| `text-[10px]` / `text-[11px]` / `text-[9px]` / `text-[8px]` / `text-[7px]` | 1,431 / 570 / 338 / 43 / 3 | 2,385 arbitrary sizes. Anything below 11px is illegible on most displays. |
| Other arbitrary sizes (`text-[13px]`, `[15.5px]`, `[12.5px]`…) | 31 | |
| `style={{ … }}` objects | **5,850** | Mostly `var(--theme-*)` colours that should be utility classes. |
| `var(--theme-muted-text)` / `var(--theme-surface-border)` inline | 2,553 / 1,392 | |
| 6-digit hex literals in TSX | 2,691 in 137 files | Marketing/gallery are the bulk. In-app examples: `#7C3AED` task header, Tailwind blues/greens in the workflow node catalog. |
| Tailwind-default hex (`#DC2626`, `#22C55E`, `#8B5CF6`, `#3B82F6`, `#F59E0B` …) | 294 | Off-brand saturated colours in a muted brand. |
| Raw palette classes (`bg-gray-*`, `text-red-*` …) | 795 | Remapped by `!important` globals. |
| Radius classes | `rounded-lg` 960, `rounded` 754, `rounded-full` 471, `rounded-xl` 291, `rounded-md` 243, `rounded-2xl` 148 + 6 arbitrary | globals.css forces `rounded-lg` **and** `rounded-xl` to the same 12px, so there is no radius hierarchy. |
| Lucide icon sizes in use | 24 distinct (6–48px); `size={8..11}` = 472 | No size rule. Stroke is always the 2px default. |
| `<button>` raw vs `<Button>` | 980 vs 639 | |
| `<input>` raw vs `<Input>` | 442 vs 445; plus 272 raw `<select>` | |
| Cards: `<Card>` vs hand-rolled `rounded-* border` divs | 162 vs ~773 | |
| Modals: Radix dialog vs hand-rolled `fixed inset-0` | 38 vs 67 files | |
| Radix dropdown-menu / tooltip users | 2 / 2 files (243 native `title=` tooltips) | |
| Tab bars (`role="tab"`/`aria-selected`) | 23 files, at least 5 visual styles | |
| `EmptyState` users vs ad-hoc "No … yet" strings | 8 vs 100 | |
| `loading.tsx` / `error.tsx` / `not-found.tsx` | 47 / **0** / 1 (Next default) | |
| `tabular-nums` | 22 | Numbers jitter and misalign in tables and KPIs. |
| Pages with their own `metadata.title` under `(dashboard)` | 3 | Every other tab reads "UserTasks — Open-Source Headless Workflow Engine". |
| Theme density tokens (`--theme-density-*`) consumed by components | **0** | The theme designer's density setting does nothing. |
| `uppercase` + `tracking-wider` | 362 / 208 | Uppercase micro-labels everywhere: a "template" tell. |

---

## 1. Diagnosis: the top 10 reasons it feels boilerplate

1. **No type scale. Micro-text is the default.** There are 2,385 arbitrary pixel sizes, mostly 9–11px,
   often in uppercase with wide tracking. Body copy jumps between 10, 11, 12, 13 and 14px in a single
   card. Fraunces (a display serif) is used for every in-app h1 and h2, and for card titles such as
   "Profile". At 16–22px it reads as a blog, not a tool.
   *See `20-settings--light.png`, `14-reports--light.png`, `05-automations-list--light.png` (10px meta
   rows), `04-task-detail--light.png` (a four-line serif title).*

2. **Flat hierarchy: one radius, one shadow, one border for everything.**
   - globals.css forces `rounded-lg`/`rounded-xl` to `--theme-border-radius` and `rounded-md` to
     `--theme-button-radius`, so chips, inputs, cards and panels all look alike.
   - Every bordered `rounded-*` element also gets the card shadow, so nested cards stack shadows. See
     the governance role cards: card → inner card → inner card (`22-settings-governance--light.png`).

3. **Missing primitives, so every page re-invents controls.**
   - Tabs come in five styles: a pill-in-tray (Home), black filled segments (Forms, Reports, Data,
     Agents), underline (Packages, Governance, run detail), text tabs that wrap onto three lines
     ("Buttons & header" in `09-form-designer--light.png`), and a black list/grid toggle.
   - There are 67 hand-rolled modals and 272 unstyled native `<select>`s with the OS chevron (see
     `16-integrations--light.png` filters).

4. **Colour is not governed.** Semantic, brand and Tailwind-default colours are mixed at random:
   - The Tasks table header is a solid accent bar with a hard-coded violet `#7C3AED` "Due Date" column
     (`03-tasks-list--light.png`, `components/tasks/timesheet-helpers.tsx:246`).
   - Agents' "Active" pills are emerald (`18-agents--light.png`).
   - Workflow nodes use Tailwind blue, purple, green and red (`lib/workflow-schema.ts` `color:`).
   - The report bar is saturated `#1D4ED8` (`15-report-detail--light.png`).
   - Nav counts are alarm-red for routine counts ("My Tasks 14").

5. **Pages have no shared header or layout grid.**
   - Page titles vary: `text-2xl semibold`, `text-xl bold`, an icon plus title (Packages), a back arrow
     plus title, or a title plus inline date range ("My Tasks 02 Nov – 08 Nov 2026").
   - Actions sit sometimes in the header and sometimes in the toolbar row (compare Workflows with
     Agents).
   - The top bar spends its left half on "Good afternoon, Ada / WEDNESDAY, NOVEMBER 4" on every page
     instead of a breadcrumb.
   - There are no breadcrumbs except on task detail.

6. **Tables are not designed.**
   - The data table rows are about 170px tall because cells wrap. Numbers are left-aligned with no
     `tabular-nums`. There is a redundant "Table data" card above the grid (`12-data-table--light.png`).
   - The Tasks list is a tinted card grid posing as a table.
   - The Home list uses 50px rows with grey pill priority badges.
   - Reports use a tan header row. Four different table looks in total.

7. **Action overload and icon soup.**
   - The forms library shows 9 actions per row, 7 of them unlabeled icons, plus a 44-chip tag cloud
     that pushes content below the fold (`08-forms-library--light.png`).
   - The workflow designer shows 2 header rows with 15 buttons, plus 4 columns that squeeze the canvas
     to about 340px (`06-workflow-designer--light.png`).
   - Cards repeat download, map and tag icons with no tooltips.

8. **Cards everywhere, and wrong card density.**
   - Content is boxed by default: KPI tiles with an orphaned second row (`14-reports--light.png` 5+2).
   - "Most complex" cards have mismatched heights and 2px dark borders.
   - Settings uses a narrow 550px card in a 1,180px canvas.
   - The integration cards keep 40% empty space and show a stray "+".
   - Three pages repeat the same "Build with AI" MCP banner above the content.

9. **States are unfinished, and so is the copy.**
   - Skeletons do not shimmer: `page-skeleton.tsx` animates `background-position` on a solid colour, so
     they show as static grey bars.
   - The search dropdown shows plain "Searching…" text (`40-command-search--light.png`).
   - There is no `error.tsx` anywhere.
   - The 404 is Next's unstyled default in a serif (`32-not-found--light.png`).
   - Empty states are ad-hoc in 100 places.
   - Copy has pluralisation bugs: "1 runs", "1 references", "1 tools".
   - Dates use five formats: `11/4/2026, 1:14:12 PM`, `Oct 27`, `27 Oct`, `2026-10-14`, `6 days ago`.

    Copy and micro-interactions also read as scaffolded:
    - Title Case is mixed with sentence case: "Create Task", "Save Changes", "New Automation",
      "Compared With Typical Run", "Executed Nodes".
    - Terminology is inconsistent: Workflows vs New Automation, Packages vs Gallery, Forms appearing
      in both the sidebar dropdown and the nav.
    - Buttons scale to 0.97 on press, which feels toy-like.
    - There are no tooltips on icon buttons and no keyboard hints beyond ⌘K.
    - Every browser tab has the same marketing title.
    - The canvas and sidebar both carry a decorative dot texture.

10. **The default theme has no dark mode, and where dark exists, depth disappears.**
    - Only **3 of 37** built-in presets define a `dark` palette (`lib/themes.ts`). The default,
      Gallery (`basecamp`), is not one of them.
    - Its stored dark palette has a light surface (`#FAF8F3`), so "Follow device" and the theme
      designer's Dark preview render light (`01-home--dark.png`, `21c-theme-gallery-dark-preview--dark.png`).
    - On a real dark theme (Noir, `21b-theme-noir-preview--dark.png`), the mode-independent theme shadows
      vanish. Cards, popovers and the page then separate only by faint borders.
    - Every reference product ships a first-class dark mode, so this alone reads as "unfinished".
    - **Decision:** Gallery and Atelier gain a dark palette derived from Noir, so the default theme
      follows the OS. Elevation becomes mode-aware (§2.6). Workstream A owns this.

---

## 2. Design-system foundations

All foundations are CSS custom properties in `app/globals.css`, exposed to Tailwind v4 through
`@theme inline`. They **derive from the existing `--theme-*` workspace variables** wherever colour is
involved, so every workspace theme, light and dark, keeps working with no schema change. New
variables are prefixed `--ds-*` (design system). Theme-controlled variables remain `--theme-*`.

### 2.1 Fonts (decision)

| Role | Family | Loaded via | Rationale |
|---|---|---|---|
| UI sans (`--font-sans`) | **Inter** (variable, `opsz` axis) | `next/font/google`, `axes: ['opsz']`, `display: 'swap'` | The best small-size legibility of any free UI face, with true tabular figures (`tnum`) and slashed zero (`zero`). It is the de-facto face of the reference products (Linear, Vercel dashboard, Retool), so it reads as "serious tool" right away. |
| Mono (`--font-mono`) | **JetBrains Mono** (400, 500) | `next/font/google` | Space Mono is a wide display mono: field keys, IDs and expressions at 11–12px get long and quirky. JetBrains Mono is narrow, clear (0/O, 1/l) and already in `CURATED_FONTS`. |
| Display (`--font-display`) | **Fraunces**, kept for the **marketing site, docs hero and Submitted page only** | `next/font/google` (already loaded) | Keeps brand continuity on public surfaces. In-app headings move to Inter, because a serif at 18–22px in dense UI is the main reason the app reads as editorial rather than enterprise. |

Inter feature settings, set on `html`:
`font-feature-settings: "cv11", "ss01", "ss03"` (single-storey a off, open digits, curved r).
Also apply `font-variant-numeric: tabular-nums` through the `.num` utility and every numeric table cell.
`-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;`.

**Theme compatibility.** Workspace themes still set `--theme-font-sans/display/mono` (via
`lib/theme/to-css.ts`), and those override the defaults exactly as today. Uploaded fonts and other
Google fonts keep working.

**Changes in `lib/theme/fonts.ts`:**

- Inter gets `bundledVar: '--font-sans'` and JetBrains Mono gets `bundledVar: '--font-mono'`.
- DM Sans and Space Mono lose `bundledVar`. They become ordinary curated Google fonts that are still
  selectable, and are served from Google like the other curated fonts.

**[migration]** Built-in presets switch `typography.sans` to Inter and `mono` to JetBrains Mono. They
also set `headingFont: 'sans'` (the brand presets basecamp, trailside and night-drive currently have
`displayHeadings: true`). The theme bootstrap default `theme_headings` changes from `display` to
`sans`. See §9 for stored themes.

### 2.2 Type scale

The base stays 16px (`html` font-size follows `--theme-font-size-scale`, so a theme's `baseSize`
still scales everything). Sizes are in rem so they scale too.

| Token | Size / line | Weight | Tracking | Tailwind class | Use |
|---|---|---|---|---|---|
| `--ds-text-2xs` | 0.6875rem (11px) / 1rem | 500 | 0.01em | `text-2xs` | **Floor.** Badges, kbd, table-header captions, chart ticks. Nothing smaller anywhere in the app. |
| `--ds-text-xs` | 0.75rem (12px) / 1rem | 400/500 | 0 | `text-xs` (Tailwind default) | Meta lines, helper text, timestamps, breadcrumbs |
| `--ds-text-sm` | 0.8125rem (13px) / 1.25rem | 400/500 | 0 | `text-ui` (new) | **Default UI text**: table cells, menu items, buttons, nav, tabs, inputs in the app chrome |
| `--ds-text-base` | 0.875rem (14px) / 1.25rem | 400 | 0 | `text-sm` (Tailwind default) | Body copy, descriptions, dialog body, form-runtime helper |
| `--ds-text-md` | 1rem (16px) / 1.5rem | 600 | -0.006em | `text-base` | Card and section titles, dialog titles |
| `--ds-text-lg` | 1.125rem (18px) / 1.625rem | 600 | -0.012em | `text-lg` | Sub-page titles, sheet titles, empty-state title (large) |
| `--ds-text-xl` | 1.375rem (22px) / 1.75rem | 600 | -0.018em | `text-title` (new) | **Page title (h1)**, one per page |
| `--ds-text-2xl` | 1.75rem (28px) / 2.125rem | 600 | -0.022em | `text-metric` (new) | KPI values (with `tnum`) |
| `--ds-text-display` | clamp(2.25rem, 4vw, 3.75rem) / 1.08 | Fraunces 600 | -0.02em | `text-display` | Marketing heroes only |

Rules:

- Weights are 400, 500 and 600 only. `font-bold` (169 uses) maps to 600, so no 700 in the app.
- **No uppercase micro-labels** except sidebar section labels. Those are 11px, 500, sentence case,
  muted, with no letter-spacing. Table headers are sentence case at 12px/500 muted. KPI labels are
  sentence case at 13px/500 muted.
- Line length: descriptions are capped at `max-w-[72ch]`.
- Codemod map:

  | From | To |
  |---|---|
  | `text-[7/8/9/10px]` | `text-2xs` |
  | `text-[11px]` | `text-2xs` |
  | `text-[12px]` | `text-xs` |
  | `text-[13px]` | `text-ui` |
  | `text-[15px]` / `[15.5px]` | `text-sm` or `text-base` by role |

  Then review any `uppercase tracking-wider` on the same element and drop both.

- Theme `uppercaseLabels: true` still uppercases form `label`s (form runtime only). Unchanged.

### 2.3 Spacing rhythm

The 4px base grid stays (Tailwind's default spacing). Usage rules:

| Context | Value |
|---|---|
| Inline gap icon↔label | 6px (`gap-1.5`) in controls, 8px (`gap-2`) in nav and menu items |
| Control internal padding x | 10px (sm), 12px (md), 14px (lg) |
| Card padding | 16px (`p-4`) default, 20px (`p-5`) for feature cards, 12px (`p-3`) for compact tiles |
| Between stacked fields | 16px (`space-y-4`); label → control 6px |
| Between sections in a page | 32px (`space-y-8`); within a section 16px |
| Page gutter | 24px (`px-6`) at ≥md, 16px below; 32px (`px-8`) at ≥1536px |
| Page header → content | 24px |
| Grid gaps | 12px for tiles/cards (`gap-3`), 16px for columns of panels |

The ad-hoc values `p-0.5/1.5/2.5/7` and `gap-0.5` are allowed only inside primitives.

### 2.4 Radii

The global `[class*="rounded-*"] !important` overrides are replaced by a mapped scale. Theme `shape.*`
values still drive it.

| Token | Default | Theme source | Tailwind | Used for |
|---|---|---|---|---|
| `--ds-radius-xs` | 4px | `shape.badgeRadius` | `rounded-sm`, `rounded` | Badges, tags, kbd, checkbox |
| `--ds-radius-sm` | 6px | `shape.buttonRadius` / `inputRadius` | `rounded-md` | Buttons, inputs, selects, menu items, segmented thumb, nav items |
| `--ds-radius-md` | 8px | `shape.cardRadius` | `rounded-lg` | Cards, popovers, menus, table containers, toasts |
| `--ds-radius-lg` | 12px | `shape.dialogRadius` | `rounded-xl`, `rounded-2xl` | Dialogs, sheets, the large hero panels |
| full | 9999px | — | `rounded-full` | Avatars, status pills, toggles, count pills |

In `@theme inline`:
`--radius-sm: var(--ds-radius-xs); --radius: var(--ds-radius-xs); --radius-md: var(--ds-radius-sm); --radius-lg: var(--ds-radius-md); --radius-xl: var(--ds-radius-lg); --radius-2xl: var(--ds-radius-lg);`
where `--ds-radius-sm: var(--theme-button-radius)` and so on.

**[migration]** The default preset values change: card 12→8, button 8→6, input 8→6, dialog 16→12.
Rationale: smaller radii read as precise and dense, and 12px cards look consumer-grade. Custom themes
keep their stored values.

### 2.5 Borders (hairlines)

Borders are derived, so every theme gets three steps automatically. Write these in `:root` (they are
mode-agnostic because they mix theme colours):

```css
--ds-border-subtle: color-mix(in srgb, var(--theme-surface-border) 55%, var(--theme-card-bg)); /* row dividers, inner separators */
--ds-border:        var(--theme-surface-border);                                                 /* cards, inputs, popovers */
--ds-border-strong: color-mix(in srgb, var(--theme-card-text) 24%, var(--theme-card-bg));        /* input hover, selected card */
--ds-border-focus:  var(--theme-focus-ring);
```

Rules:

- All borders are 1px.
- No 2px borders, except the selected template/thumb state (2px `--theme-primary`) and the
  dashed drop zones.
- Cards use `--ds-border`, table row dividers use `--ds-border-subtle`, and inputs use
  `--theme-input-border` with `--ds-border-strong` on hover.

### 2.6 Elevation

Theme shadows today are mode-independent (`shadows.*` in the schema), so dark mode gets invisible
black-on-black shadows. Decision: **cards are flat** (border, no shadow). Elevation is reserved for
things that float.

| Level | Token | Light | Dark (`[data-theme-mode=dark]`) | Use |
|---|---|---|---|---|
| 0 | `--ds-elev-0` | `none` | `none` | Cards, panels, tables (border only) |
| 1 | `--ds-elev-1` | `0 1px 2px rgb(16 16 20 / .06)` | `0 1px 2px rgb(0 0 0 / .4), inset 0 1px 0 rgb(255 255 255 / .04)` | Segmented thumb, sticky header, hovered interactive card, primary button |
| 2 | `--ds-elev-2` | `0 0 0 1px var(--ds-border), 0 4px 12px -2px rgb(16 16 20 / .08), 0 2px 4px -2px rgb(16 16 20 / .04)` | `0 0 0 1px var(--ds-border), 0 8px 24px -4px rgb(0 0 0 / .55), inset 0 1px 0 rgb(255 255 255 / .05)` | Popovers, menus, tooltips, toasts, command palette, autocomplete |
| 3 | `--ds-elev-3` | `0 0 0 1px var(--ds-border), 0 16px 40px -8px rgb(16 16 20 / .18), 0 6px 16px -6px rgb(16 16 20 / .08)` | `0 0 0 1px var(--ds-border), 0 24px 56px -12px rgb(0 0 0 / .7), inset 0 1px 0 rgb(255 255 255 / .06)` | Dialogs, sheets, form designer |

**Floating surface colour.** In dark mode, floating layers also lift their background:
`--ds-bg-elevated: color-mix(in srgb, var(--theme-card-bg) 92%, white)` in dark and
`var(--theme-card-bg)` in light.

**Theme compatibility.** The existing `--shadow-sm/md/lg/xl` and `--theme-card-shadow` stay defined
(older code still reads them). New code reads `--ds-elev-*` only. A custom theme that sets non-default
shadows: `to-css.ts` emits `--ds-elev-1/2/3` from `shadows.sm/lg/xl` **for light mode only**. Dark
mode always uses the platform values above. **[migration]** Custom shadows no longer apply in dark
mode, which is a fix, because they were invisible there.

### 2.7 Colour usage: neutral first, brand on purpose

These are semantic aliases exposed as Tailwind colours (`@theme inline`), so pages write `text-fg-muted`
instead of `style={{ color: 'var(--theme-muted-text)' }}`:

```css
--color-bg:            var(--theme-surface);        /* page canvas */
--color-panel:         var(--theme-card-bg);        /* cards, tables */
--color-elevated:      var(--ds-bg-elevated);       /* popovers, dialogs */
--color-subtle:        color-mix(in srgb, var(--theme-card-text) 4%, var(--theme-card-bg)); /* table header, hover row, wells */
--color-muted:         color-mix(in srgb, var(--theme-card-text) 7%, var(--theme-card-bg)); /* pressed, selected neutral, skeleton */
--color-fg:            var(--theme-card-text);
--color-fg-muted:      var(--theme-muted-text);
--color-fg-subtle:     color-mix(in srgb, var(--theme-muted-text) 75%, var(--theme-card-bg)); /* placeholders, disabled (decorative only) */
--color-border:        var(--ds-border);
--color-border-subtle: var(--ds-border-subtle);
--color-border-strong: var(--ds-border-strong);
--color-primary:       var(--theme-primary);
--color-primary-fg:    var(--theme-on-primary);
--color-primary-text:  var(--theme-primary-text);
--color-primary-wash:  var(--theme-primary-light);
--color-accent:        var(--theme-accent);
--color-success: var(--theme-success);  --color-success-wash: var(--status-success-bg);
--color-warning: var(--theme-warning);  --color-warning-wash: var(--status-warning-bg);
--color-danger:  var(--theme-danger);   --color-danger-wash:  var(--status-danger-bg);
--color-info:    var(--status-info);    --color-info-wash:    var(--status-info-bg);
```

Where colour is allowed:

| Use | Colour |
|---|---|
| ~90% of UI: text, borders, backgrounds, icons, secondary and ghost buttons, table headers | **Neutral** |
| The single primary action per region, checked controls, the active nav indicator bar, the selected tab underline, links, progress fill, focus ring | **Brand primary** |
| Brand moments only: logo mark, marketing, the first chart series, the Submitted page | **Accent** |
| Status pills, inline notices, destructive actions, deadline text | **Semantic** (success, warning, danger, info). Never decorative. |

**Banned:**

- Coloured table headers.
- Coloured section backgrounds (the tan MCP banner, tinted task rows).
- Tailwind default hex values in app code. A lint rule (§8) blocks them outside `components/marketing`
  and `components/gallery`.

**Nav counts** use a neutral pill. Danger is used only when the count means overdue or failed, for
example "3 failed".

### 2.8 Focus ring

One ring everywhere, drawn with `outline` so it follows radius and never fights `ring-offset` colours
inside form themes.

```css
:where(a, button, [role="button"], [role="tab"], [role="menuitem"], summary, [tabindex]):focus-visible {
  outline: 2px solid var(--theme-focus-ring);
  outline-offset: 2px;
}
:where(input, select, textarea, [contenteditable="true"]):focus-visible {
  outline: none;
  border-color: var(--theme-focus-ring);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-focus-ring) 22%, transparent);
}
```

`legibility.ts` already guarantees ≥3:1 for `focusRing` on the card. Keep that check. Remove the
per-component `focus-visible:ring-*` classes from the primitives.

### 2.9 Motion

```css
--ds-dur-instant: 80ms;   /* press, checkbox */
--ds-dur-fast: 120ms;     /* hover colour, icon swaps */
--ds-dur-base: 180ms;     /* menus, popovers, tabs indicator, accordion */
--ds-dur-slow: 260ms;     /* dialogs, sheets, toasts */
--ds-ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* entrances */
--ds-ease-in: cubic-bezier(0.7, 0, 0.84, 0);       /* exits (use 0.7× duration) */
--ds-ease-standard: cubic-bezier(0.2, 0, 0, 1);    /* state changes */
```

- **Popover/menu enter:** opacity 0→1, `translateY(-4px)`→0 and `scale(.98)`→1, over `base` with
  `ease-out`. Transform origin is the Radix `--radix-*-content-transform-origin`.
- **Dialog enter:** opacity plus `scale(.97)`→1 over `slow`. The overlay fades over `base`.
- **Sheet:** slides 16px plus fades.
- **Toasts:** slide up 8px plus fade.
- Remove `active:scale-[0.97]` from Button. Use a pressed background instead.
- Remove `transform` from the global transition rule.
- Skeleton shimmer runs at 1.4s linear.
- `@media (prefers-reduced-motion: reduce)` sets all `--ds-dur-*` to 0ms and disables the shimmer,
  glowPulse, floatY and orbit keyframes.

### 2.10 Density

The theme's `layout.density` is finally wired. Default: **comfortable**. Rationale: enterprise users
scan many rows, and 40px rows at 13px are the Linear/Stripe sweet spot.

| Token | compact | comfortable (default) | spacious |
|---|---|---|---|
| `--theme-density-row-height` (table rows, list rows) | 32px | 40px | 48px |
| `--ds-control-h` (md buttons/inputs in app chrome) | 28px | 32px | 36px |
| `--theme-density-cell-x` | 8px | 12px | 16px |
| `--ds-nav-item-h` | 28px | 32px | 36px |

The form runtime (`/f/`, `/p/`, task forms) keeps **40px controls** regardless of density, because it
serves end users on touch devices. On `(pointer: coarse)` the minimum control height is 40px
everywhere.

### 2.11 Icons

- **Lucide only.**
- Sizes: **16px** default (nav, buttons md, inputs, menu items, tabs), **14px** (sm buttons, table
  cells, badges, meta lines), **20px** (page-header icon tiles, empty states, toasts). 12px is allowed
  only inside 20px badges and kbd.
- Nothing below 12px, and none of the other 20 sizes in use.
- Stroke: **1.75** globally via `svg.lucide { stroke-width: 1.75 }`. This is CSS, which beats the
  presentation attribute, so it is a one-line change. Use 1.5 at 20px and above (`.lucide-lg`).
- Icon colour: `currentColor`, inheriting `fg-muted` in secondary contexts and `fg` when active.
- Never colour icons with semantic colours unless they are status icons.
- Every icon-only button needs an `aria-label` and a Tooltip.

---

## 3. Component specs (`components/ui`)

Each primitive below lists anatomy, sizes, states and the change from today. "Today" refers to the
current file or the dominant ad-hoc pattern. All primitives use `--ds-*` and semantic colour utilities.
None take inline `style` for colour.

### 3.1 Button (`button.tsx`, rewrite)

- **Variants:**

  | Variant | Look |
  |---|---|
  | `primary` | Brand fill, `elev-1` |
  | `secondary` | `panel` background, 1px `border`, `fg` text. Replaces `outline`. |
  | `ghost` | Transparent, `fg-muted` → `fg` on hover |
  | `danger` | Danger fill, `on-danger` text |
  | `danger-ghost` | Danger text, danger-wash on hover |
  | `link` | Primary-text, underline on hover |

- **Sizes:**

  | Size | Height | Padding x | Text | Icon |
  |---|---|---|---|---|
  | `sm` | 28px | 10px | 12px/500 | 14px |
  | `md` (default) | `var(--ds-control-h)` = 32px | 12px | 13px/500 | 16px |
  | `lg` | 36px | 14px | 14px/500 | 16px |

  `icon-sm`/`icon`/`icon-lg` are squares of the same heights.

- **States:**

  | State | Look |
  |---|---|
  | hover | primary uses `--theme-primary-hover`; secondary and ghost use the `subtle` background; secondary's border becomes `border-strong` |
  | active | the `muted` background (secondary and ghost) or `color-mix(primary 88%, black)` |
  | focus | the global ring |
  | disabled | opacity .45, `cursor-not-allowed`, no shadow |
  | loading | the `loading` prop swaps the leading icon for a 14px spinner, keeps the width (`min-width` locked) and sets `aria-busy` |

- **Slots:** `leadingIcon`, `trailingIcon`, `kbd` (shortcut hint shown right-aligned in a `Kbd`).
- **Today → after:**
  - 40px default → 32px.
  - Remove `active:scale`.
  - Rename `default`→`primary` and `outline`→`secondary`. Keep both old names as aliases for one
    release so pages compile.
  - `ConfirmDialog`'s `!bg-red-600` hack is replaced by `variant="danger"`.
- **Rule:** at most one `primary` per page header or dialog footer.

### 3.2 IconButton (new, `icon-button.tsx`)

- A Button `ghost` `icon` size with a **required** `label` prop. It renders a Tooltip and an
  `aria-label`.
- Use it for all toolbar, row and card icon actions (forms library rows, workflow card icons, designer
  toolbar).

### 3.3 Input, Textarea, Select, Checkbox, Radio, Switch (`input.tsx` rewrite; new `textarea.tsx`, `select.tsx`, `checkbox.tsx`, `switch.tsx`, `field.tsx`)

- **Input:**
  - Height `--ds-control-h` (32px); `sm` 28 and `lg` 40 (form runtime).
  - Padding x 10px, 13px text. Background `--theme-input-bg`, 1px `--theme-input-border`,
    radius sm.
  - Placeholder in `fg-subtle`. Hover border `border-strong`. Focus per §2.8.
  - Invalid: `aria-invalid` gives a danger border and a 3px danger 18% ring.
  - Disabled: the `subtle` background and `fg-muted` text.
  - Slots: `leading` (icon 16, muted) and `trailing` (clear button, unit, kbd).
  - **Today:** it uses `--theme-topbar` as its background (wrong token) and `hover:border-gray-400`
    (a raw Tailwind class).
- **SearchInput:** Input with a leading search icon and a trailing clear button and kbd hint. It
  replaces `SearchBar` in `list-controls.tsx`, which today is a raw `<input>`.
- **Select:** a styled **native** `<select>` with `appearance:none` and a 16px `ChevronsUpDown` icon on
  the right. It is accessible, fits mobile, and needs no new dependency. It replaces the 272 raw
  selects. Rich pickers stay in `searchable-*-picker.tsx`, restyled to match: their trigger matches
  Input and their panel is a Popover.
- **Checkbox and Radio:** 16px, radius xs (checkbox) or full (radio), border `border-strong`; checked
  is a primary fill with a `on-primary` check. Use native inputs plus `accent-color` fallback styling
  via `appearance:none`.
- **Switch:** 28×16 track; thumb 12px, `elev-1`.
- **Field** (anatomy wrapper):
  - Label: 13px/500 `fg`. An optional "Optional" suffix in `fg-muted` replaces the red asterisk in the
    app chrome; the form runtime keeps the asterisk.
  - The control, 6px below the label.
  - Description (12px muted) *or* error (12px danger with a 14px icon), 6px below the control.
  - Ties `aria-describedby` and `aria-invalid` together.

### 3.4 Card (`card.tsx`)

- **Anatomy:** `Card` (panel background, 1px border, radius md, **no shadow**, no padding by default).
  Its parts are `CardHeader` (16px padding, title 16/600, optional description 13 muted, actions
  slot), `CardBody` (16px) and `CardFooter` (12px 16px, `subtle` background, border-top subtle).
- **Variants:**

  | Variant | Use |
  |---|---|
  | `interactive` | Hover border `border-strong` plus `elev-1`; cursor pointer. For whole-card links. |
  | `inset` | `subtle` background, no border, for wells inside cards. **Replaces nested cards.** |

- **Today → after:** `p-6` with a `shadow-md` inline style becomes flat with explicit parts, and
  `transition-all` is dropped.
- **Rule:** never nest a bordered Card in a Card. Use `inset` or a divider.

### 3.5 PageHeader (new, `page-header.tsx`)

```
[breadcrumbs 12px muted › …]                                  (optional)
[Title 22/600]  [status badge?]                  [secondary] [secondary] [Primary] [⋯]
[Description 14 muted, max 72ch]                                       (optional)
[Tabs (underline)]                                                       (optional)
```

- **Spacing:**
  - Breadcrumbs → title: 8px.
  - Title → description: 4px.
  - Header → tabs: 16px.
  - Tabs carry a bottom border (`border-subtle`, full bleed).
  - Header → content: 24px.
- **Actions:** at most three visible buttons. The rest go in an overflow `DropdownMenu` (`⋯`).
- **Back:** breadcrumbs replace the free-floating back arrow. Detail pages show `Parent › Item`.
- **Sticky (optional):** `sticky` + `top-0` + `bg/80 backdrop-blur` + a bottom hairline after scrolling
  (`data-stuck`), for long pages (task detail, designer).
- **Props:** `title`, `description?`, `breadcrumbs?`, `badge?`, `actions?`, `tabs?`, `icon?` (a 32px
  tile, used only on object detail pages such as a data table or integration).

### 3.6 Tabs and SegmentedControl (new, `tabs.tsx` and `segmented-control.tsx`)

- **Tabs** switch between page views (Governance, Data rows/schema/access, run detail, designer
  inspector):
  - Height 36px; 13px/500 text; `fg-muted` → `fg` on hover.
  - Active: `fg` plus a 2px primary underline that animates position over `base` with
    `ease-standard`.
  - Count: a neutral `CountBadge` after the label, e.g. "Rows 32".
  - Overflow: horizontal scroll with fade masks. **Labels never wrap.**
  - Keyboard: roving tabindex and arrow keys.
- **SegmentedControl** handles mode and filter toggles of two to five options (7/30/90 days, list/grid,
  All/Active/Inactive, Light/Dark, layout Single/Steps/Tabs):
  - Track: the `muted` background, 2px padding, radius sm. Height 28px (sm) or 32px (md).
  - Thumb: the `panel` background with `elev-1` and radius `calc(sm - 2px)`.
  - Text: 12–13px/500; active `fg`, inactive `fg-muted`.
  - Icon-only segments need tooltips.
- **Today → after:** the black filled segments (Forms/Form themes, Reports, Data, list/grid, 7/30/90)
  and the pill-in-tray tabs (Home) all become one of these two. Fixed rule: **navigation → Tabs;
  filtering or mode → SegmentedControl.**

### 3.7 Badge, StatusPill, Tag and CountBadge (rewrite `status-badge.tsx` and `priority-badge.tsx`; new `badge.tsx`)

One semantic set:

| Tone | Background | Text | Dot |
|---|---|---|---|
| `neutral` | `muted` | `fg-muted` | `fg-subtle` |
| `info` | `info-wash` | `info` | `info` |
| `success` | `success-wash` | `success` | `success` |
| `warning` | `warning-wash` | `warning` | `warning` |
| `danger` | `danger-wash` | `danger` | `danger` |
| `brand` | `primary-wash` | `primary-text` | `primary` |

- **StatusPill:**
  - Height 20px, padding x 6px, radius full, 12px/500 text, a 6px dot plus the label. No border.
  - Sentence case: "In progress", not "In Progress".
  - Status → tone mapping:

    | Tone | Statuses |
    |---|---|
    | neutral | todo, draft, cancelled, inactive |
    | info | in_progress, running, processing |
    | warning | waiting_for_event, awaiting_approval, paused |
    | danger | blocked, failed |
    | success | completed, active, published |
    | brand | migrated |

  - Active workflows, integrations and agents use `success` with the same component.
    Emerald and Tailwind green are gone.
- **Priority:** not a pill. Use a 14px signal icon (bars) plus the label in `fg-muted`:

  | Priority | Colour |
  |---|---|
  | critical | danger |
  | high | warning |
  | medium | neutral |
  | low | subtle |

  Rationale: a column of "High" grey pills (Home, Tasks) is visual noise.
- **Tag** (user labels such as finance or kyc): height 20px, radius xs, a 1px `border` plus the
  `panel` background, 12px `fg-muted`, optional leading 12px tag icon only in filter bars.
- **CountBadge:** min-width 18px, height 18px, radius full, 11px/600 `tnum`, `muted`/`fg-muted`
  (danger tone only for overdue or failed). Used in nav, tabs and section headers.
- **Version badge:** `v2` uses Tag with mono 11px.

### 3.8 Table (new, `table.tsx` + `data-table` helpers)

A styling layer only (`Table`, `THead`, `TR`, `TH`, `TD`, `TableEmpty`, `TableSkeleton`). The data
grid keeps its own logic but uses these classes.

- **Container:** Card (no padding), with radius md and overflow clip. A horizontal-scroll wrapper adds
  a right **scroll shadow** when overflowing.
- **Header:**
  - Height 32px, the `subtle` background, sentence case at 12px/500 `fg-muted`, `border-subtle`
    bottom.
  - **Sticky** (`top: 0`, or below a sticky PageHeader).
  - Sort indicator: a 14px chevron that appears on hover and stays while sorted.
  - Resizable columns where the grid supports them.
- **Rows:**
  - Height `var(--theme-density-row-height)` (40px). Cells padding x
    `var(--theme-density-cell-x)`, 13px `fg`.
  - Single line with `truncate` plus a Tooltip on overflow.
  - **No zebra.** Dividers are `border-subtle`.
  - Hover: the `subtle` background. Selected: `primary-wash` with a 2px primary inset left bar.
  - Clickable rows: `cursor-pointer` and a focusable row with `Enter` to open.
- **Alignment:**
  - Text left; numbers, currency and durations **right**, with `tnum`.
  - Dates left, with `tnum`.
  - Status column fixed width. Actions column right, 32px icon buttons, **visible on row hover/focus
    only** (always visible on touch).
- **First column:** 500 weight (the row's name), with an optional 12px muted secondary line.
  Comfortable density only, and row height grows to 52px when used.
- **Footer:** pagination 32px controls, "1–25 of 312" in 12px muted `tnum`, rows-per-page Select sm.
- **Empty:** `TableEmpty` renders EmptyState `size="sm"` inside the body.
- **Loading:** 6 skeleton rows at the real row height.
- **Today → after:** four table styles become one. The tan header in reports and the tasks table,
  the violet column and the 170px wrapping cells are all removed.

### 3.9 StatCard and Metric (rewrite `stat-card.tsx`; replaces `metric-cards.tsx` and `report-metric-row.tsx` tiles)

- **Anatomy:**
  - Label: 13px/500 `fg-muted`, sentence case, optional 14px leading icon and an info tooltip.
  - Value: 28px/600 `tnum`, `fg`. A unit suffix in 14px `fg-muted` sits on the same baseline
    ("12.7 h", "76 %").
  - Delta chip: 12px/500; up = success-text and down = danger-text **only when direction has
    meaning**, otherwise neutral; with "vs prior 30 days" in 12px muted.
  - Optional sparkline: 32px tall, 1.5px stroke in `--theme-chart-1`, no axes.
  - Optional footer link "View all →" in 12px.
- **Container:** a Card at `p-4` and min-height 112px. Values never wrap.
- **Grid:** `grid-cols-[repeat(auto-fit,minmax(200px,1fr))]` with gap 12, so no orphan rows (the
  Reports 5+2 problem). Cap at 4 per row on ≥1280px; more tiles go into a "More metrics" disclosure.
- **Compare variant** (run detail): value plus baseline in one tile. "12 ms · baseline 14 ms ·
  −2 ms" replaces nested tiles.

### 3.10 EmptyState (`empty-state.tsx`)

- **Sizes:**

  | Size | Padding y | Use |
  |---|---|---|
  | `sm` | 24px | Inside tables and panels |
  | `md` | 48px | Default |
  | `lg` | 80px | First-run pages |

- **Anatomy:**
  - Icon: 20px in a 40px tile (radius md, `subtle` background, 1px `border`).
  - Title: 14px/600 (`lg`: 16px).
  - Body: 13px `fg-muted`, max 44ch.
  - Actions: a primary Button sm, plus an optional secondary `link` ("Learn more" → docs).
- **Variants:**

  | Variant | Copy | Action |
  |---|---|---|
  | `first-run` | Explains the value | Create |
  | `no-results` | Icon `SearchX`, "No results for '…'" | "Clear filters" |
  | `error` | Icon `AlertTriangle` (danger tone in the tile) | "Try again" |

- **Copy rule:** the title states the situation ("No forms yet") and the body states what it is for
  plus the next step. Never "No data available".
- **Today → after:** replace the 100 ad-hoc empty strings. ReportChart's "No data available" becomes
  EmptyState `sm`.

### 3.11 Skeleton (`page-skeleton.tsx` → `skeleton.tsx` + page compositions)

```css
.ds-skeleton {
  background: linear-gradient(90deg, var(--color-muted) 0%, color-mix(in srgb, var(--color-muted) 40%, var(--color-panel)) 50%, var(--color-muted) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
  border-radius: var(--ds-radius-xs);
}
```

- Text skeletons are 10px tall for 13px text and 12px for 14px, with radius xs.
- Skeletons mirror the real layout: the same PageHeader, the same table row heights.
- Show skeletons only after 150ms. Below that, render nothing to avoid flashes. Use a
  `useDelayedFlag(150)` helper.
- Cross-fade content in over `base` (opacity only).
- **Today:** the animation is a no-op because the background is solid. All 47 `loading.tsx` files
  inherit the fix automatically.

### 3.12 Dialog, Sheet, ConfirmDialog (new `dialog.tsx` and `sheet.tsx`; `confirm-dialog.tsx` rebuilt on them)

- **Dialog (Radix):**
  - Overlay: `--theme-overlay` with a 2px blur (down from 4px).
  - Content: the `elevated` background, `elev-3`, radius lg.
  - Widths:

    | Size | Width |
    |---|---|
    | sm | 400px |
    | md | 560px (default) |
    | lg | 720px |
    | xl | 960px |
    | full | calc(100vw − 48px) × calc(100vh − 48px), used by the form designer |

  - Header: 20px 24px 0; title 16px/600, description 13px muted; close IconButton top-right.
  - Body: 16px 24px, scrolls internally with scroll shadows.
  - Footer: 16px 24px with a `border-subtle` top. Buttons are right-aligned: secondary, then primary.
    The destructive button sits right and is labelled with the verb ("Delete form").
  - `Enter` submits. `Esc` closes, unless the content is dirty, in which case it asks for confirmation.
- **Sheet:** right side, 480px (md) or 640px (lg); same anatomy; slides in. Use it for details,
  submissions, run logs, and "New integration" type flows that need more than 3 fields.
- **ConfirmDialog:**
  - Size sm, no icon in the title.
  - Destructive confirmations name the object ("Delete 'Vendor application'?") and state the
    consequence in the body.
  - The danger button carries the verb. Busy state uses Button `loading`.
- **Today → after:** move 67 hand-rolled `fixed inset-0` modals to Dialog or Sheet (each workstream
  moves its own).

### 3.13 DropdownMenu, Popover, Tooltip (new `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`; `floating-layer.tsx` stays for custom anchoring)

- **Menu:**
  - The `elevated` background with `elev-2`, radius md, 4px padding, min-width 200px.
  - Items: 32px tall, 13px, a 16px icon in muted, radius sm, the `subtle` background on hover or
    focus, and an optional right-aligned `Kbd`.
  - Danger items use danger text.
  - Section labels: 11px/500 muted, sentence case.
  - Separators: `border-subtle` with a 4px margin.
- **Tooltip (Radix):**
  - Delay 400ms (0ms when moving between tooltips).
  - `fg` inverted: background `--theme-card-text`, text `--theme-card-bg`. 12px/500, padding 4px 8px,
    radius sm, no arrow, offset 6px.
  - Content: label plus optional `Kbd`.
  - **Replaces 243 native `title=` tooltips** on interactive elements. Keep `title` on truncated plain
    text only as a fallback.
- **Popover:** the same surface as the menu, 12px padding.

### 3.14 Toast (restyle the rendering in `components/jobs/jobs-provider.tsx`; extract `components/ui/toast.tsx`)

- **Position:** bottom-right, 16px from the edges, 360px wide, stacking upward with 8px gaps. Max 3
  visible; older ones collapse.
- **Anatomy:**
  - A 16px tone icon: success check, danger alert, info spinner for running jobs.
  - Title 13px/600 and body 13px muted (2 lines max).
  - An optional action (Button `link` sm, e.g. "View run") and a close IconButton.
- **Behaviour:**
  - Auto-dismiss after 5s (8s with an action). Running jobs persist until done.
  - The timer pauses on hover or focus.
  - `role="status"` (or `alert` for errors).
- **Surface:** `elevated` with `elev-2`, radius md. A 2px left tone bar is optional. **No full-colour
  backgrounds.**
- **Decision:** no new dependency (not sonner). Restyle the existing provider.

### 3.15 InlineNotice (`inline-notice.tsx`)

- **Tones:** info, success, warning and danger, plus neutral.
- **Anatomy:**
  - A 16px icon, a title (13px/600, optional) and a body (13px), all in `fg`. Text uses `fg` for
    contrast; the icon carries the tone.
  - Background: the tone wash. Border: tone at 30% mixed into `border`.
  - Optional actions on the right (Button sm ghost) and a dismiss IconButton.
- **Banner variant:** full-width, radius md, used for page-level messages such as "4 live instances on
  older versions".
- **Rule:** marketing banners such as "Build with AI — connect via MCP" are **not** notices. Move the
  MCP prompt to **one** place: a dismissible card in Home's empty or first-run state, plus Settings →
  MCP. Remove it from the Workflows, Integrations and Agents headers.

### 3.16 List controls (`list-controls.tsx`)

- **Toolbar row:** height 32px controls, gap 8px.
  - Left: SearchInput (`w-[320px]`, grows to 480 at most), then filters as `FilterButton`s.
    Each `FilterButton` is a secondary sm button: "Status: Active ×". Clicking it opens a Popover with
    checkboxes.
  - Right: sort (Select sm), view toggle (SegmentedControl, icon-only), and a count ("62 workflows",
    12px muted `tnum`).
- **Tags:** shown in a "Tags" FilterButton popover, **not** as an always-visible cloud. That removes the
  44-chip cloud on Forms and the tag rows on Workflows and Integrations.
- **Bulk-select bar:** appears only when ≥1 item is selected. It is sticky at the bottom: an
  `elevated` pill with `elev-2`, "3 selected · Export · Delete · ✕".
- **Pagination:** the same component as the Table footer.

### 3.17 Other primitives

| Primitive | Change |
|---|---|
| ProgressBar | Height 6px (4px inline); track `muted`; fill primary; success at 100% (not the accent swap). Drop `dark:bg-gray-700`. |
| BusyBar | Keep. Use the `--color-primary` gradient on a `muted` track. The label is 12px muted. |
| Kbd (new) | 18px tall, min-width 18px, padding x 4px, 11px/500 mono, `muted` background, 1px `border` bottom-heavy (`box-shadow: inset 0 -1px 0 var(--ds-border)`), radius xs. |
| Avatar (new, extracted from user-menu and assignee chips) | 24/28/32px, radius full, initials 11/12/13px 600, a background derived deterministically from the name via the chart palette at 18% wash, text in that hue's text token. A 2px `panel` ring when stacked. |
| DateTimePicker / Autocomplete / Searchable pickers / TagManager | Restyle the trigger as Input and the panel as Popover. No logic changes. |
| OrgBadge | Becomes a Tag variant with an avatar dot. |
| SubmitButton | Delegates to Button `loading`. |

---

## 4. App shell

### 4.1 Sidebar (`components/layout/sidebar.tsx`, `sidebar-nav-item.tsx`)

- **Width:** 240px (from 256); collapsed 56px. The theme's `sidebarWidth` still overrides.
- **Background:** solid `--theme-sidebar`. **[migration]** The default presets drop the gradient and
  the dot texture. The schema still supports them, so custom themes that set them keep them.
- **Structure, top to bottom:**
  1. Workspace switcher: a 40px row with the logo mark, the workspace name (13px/600) and a chevron.
     Not "usertasks" in large type.
  2. The "Forms" header dropdown moves out of the sidebar into the top bar as "+ New" (see 4.2).
  3. Primary items: Home, My tasks, Task queue, Tracker.
  4. Groups: **Build** (Workflows, Forms, Data, Integrations, Agents), **Operate** (Queue, Schedules,
     Activity, Reports), **Govern** (Business rules, Retention, Packages, Extensibility), and
     **Settings** pinned at the bottom.
  5. Groups are collapsible and remember their state.
  6. Rationale: 13 items under "Automations" is a flat dump, and grouping by job matches Retool and
     Atlassian.
- **Item:**
  - Height `--ds-nav-item-h` (32px); padding x 8px; radius sm; gap 8px.
  - Icon 16px in `sidebar-muted`; label 13px/500 in `sidebar-text`.
  - Hover: `--sidebar-hover-bg`.
  - Active: `--theme-sidebar-active` background, label in `sidebar-accent`, plus a **2px × 16px
    indicator bar** at left −8px in `sidebar-accent`.
  - Disabled: opacity .5.
- **Section label:** 11px/500, `sidebar-muted`, sentence case, 24px top and 4px bottom margin, no
  uppercase.
- **Counts:** a neutral CountBadge (`rgba(sidebar-text, .12)` background). Danger only for overdue. The
  collapsed state shows a 6px dot.
- **Pinned tabs** (the open task under My tasks): keep them, but style them as a 28px sub-item with a
  12px close button visible on hover.
- **Footer:** user Avatar + name + `⋯` (moves out of the top bar? No. Decision: the **user menu stays
  top-right**, and the sidebar footer holds only "Help & docs" and the collapse toggle).

### 4.2 Top bar (`topbar.tsx`)

- **Height:** 48px (theme `topbarHeight` still overrides). `panel` background, `border-subtle` bottom,
  no shadow.
- **Left:** **breadcrumbs** of the current route (12–13px: `Workflows › Invoice approval`). Each
  route provides them through PageHeader. Remove the greeting and date, which move into the Home
  page header ("Good afternoon, Ada" as the Home h1, with the date in its description).
- **Centre-right:** a command trigger: a 32px button styled as a search input, 280px wide, "Search or
  jump to…" with `⌘K`.
- **Right:**
  - "+ New" (secondary sm) with a menu: Task, Workflow, Form, Data table, Report, plus "Fill in a
    form…", which absorbs the old header Forms dropdown's "Your forms" list.
  - The Jobs icon (layers): IconButton with a tooltip "Background jobs".
  - Notifications: IconButton with a CountBadge dot rather than a red "9+" bubble. The panel width is
    400px with grouped "Today / Earlier" headings.
  - Avatar menu (28px).

### 4.3 Command search (`global-search.tsx`)

- Use `cmdk` (already a dependency) in a Dialog-sized palette: 640px wide, `elev-3`, top 12vh.
- **Input:** 48px, 15px text, a leading search icon and an `Esc` kbd.
- **Groups:** Recent, Pages, Workflows, Forms, Tasks, Data, Actions ("Create workflow").
  - Group labels are 11px/500 muted.
  - Rows are 36px: icon 16 + title 13/500 + secondary 12 muted, with a right-aligned type tag or `↵`.
- **Loading:** 3 skeleton rows, not "Searching…". **Empty:** EmptyState `sm`.
- **Keyboard footer:** `↑↓ navigate · ↵ open · ⌘↵ open in new tab · esc close`, 11px muted.

### 4.4 Page frame (`dashboard-shell.tsx`)

- **Content gutters** per §2.3.
- **Width rules:**

  | Max width | Pages |
  |---|---|
  | `max-w-none` | Lists and grids |
  | `max-w-[1080px]` | Settings and forms-style pages |
  | `max-w-[960px]` + optional right rail 320px | Detail pages (task, run, integration) |

- `page-transition` keeps the 150ms opacity fade only (no translate).
- Remove `main` canvas texture defaults. **[migration]** See §9.

### 4.5 Error, 404 and tab titles

- `app/not-found.tsx` and `app/(dashboard)/not-found.tsx`:
  - An EmptyState `lg` inside the shell (dashboard) or the marketing frame (public).
  - The code "404" as a 12px muted overline.
  - Title "Page not found", body, and actions "Go home" and "Search (⌘K)".
- `app/(dashboard)/error.tsx`, `app/global-error.tsx` and segment `error.tsx` for the designer, form
  designer and data grid:
  - EmptyState `error` with "Try again" (`reset()`) and "Copy error ID" (the digest).
- **Titles:**
  - Root `metadata.title = { default: 'UserTasks', template: '%s · UserTasks' }`. Keep the marketing
    title on `/` only.
  - Each dashboard page exports `metadata` or `generateMetadata` (for example "Invoice approval ·
    Workflows · UserTasks").
  - Unread notifications prefix "(3)".
- **Favicon:** keep `app/icon.svg`. Add a 32px PNG fallback and a dark-mode-aware SVG
  (`prefers-color-scheme` inside the SVG).

---

## 5. Page-level recommendations

### 5.1 Home (`01-home--light.png`, `02-home-tab2--light.png`)

- **Header:** "Good afternoon, Ada" as the title, with the date and timezone as the description. The
  7/30/90 days control becomes a SegmentedControl sm on the right, and "Edit layout" becomes a ghost
  button.
- **Metric row:** the three StatCards (My tasks, My submissions, Following) are fine conceptually.
  - Use the §3.9 anatomy: drop the uppercase labels; the value is 28px `tnum`; the unit text sits on
    the same baseline; "9 overdue" becomes a danger-tone delta chip.
- **Compact charts** (My decisions, On time, My submissions):
  - Keep the dataviz approach in `lib/home/chart-palette.ts`: theme-derived and CVD-checked.
  - Bar height 8px (not 28px with in-bar labels). Labels go below as a legend: 12px, a dot plus the
    label plus a `tnum` value.
  - Radius 2px on the outer ends only, with 2px gaps between segments.
  - **Fix the off-brand fallback:** the Gallery preset's `chart` palette fails the floors, so it falls
    back to reference blue and orange. Retune `--theme-chart-*` for the built-in presets so the theme
    candidates pass (see §9). Reports use the same resolver.
- **Tabs:** "My tasks · Task queue · Following · My submissions · Favourite forms" become underline
  Tabs with counts.
- **Task table:** the Table spec. Due/SLA in `tnum`, with overdue in danger-text and a 14px clock
  icon. Priority as an icon plus label (§3.7). Assigned date is relative with a tooltip of the absolute
  date.
- **Edit-layout mode:** a dashed outline in `border-strong`, a 16px grip handle, and an "Edit layout"
  banner bar sticky at the top with "Reset" and "Done".

### 5.2 Tasks list (`03-tasks-list--light.png`, `46-empty-search-tasks--light.png`)

- Replace the timesheet-style grid with the Table:

  | Column | Content |
  |---|---|
  | (unnamed) | drag handle visible on hover |
  | Task | title, 500 weight, with the ID in mono 12 muted *before* it; org and assignee move to a secondary line |
  | Status | StatusPill |
  | Priority | icon + label |
  | Due | `tnum`, right-aligned |
  | Progress | 48px ProgressBar + `tnum` % |
  | Notes | truncated, tooltip |
  | (unnamed) | open icon |

- **Remove** the accent header bar, the `#7C3AED` Due Date column and the tinted note cells.
- **Header:** title "My tasks". The date range moves to a ghost button with a calendar icon ("This
  week ▾") next to the List/Calendar SegmentedControl. "Create task" is the primary button.
- **Filters:** Status and Priority FilterButtons replace the inline chip rows. Search sits in the
  toolbar, and the query is mirrored to `?q=` so links and back navigation work (today `?q=` is
  ignored).
- **Drag hint:** "Drag tasks to reorder priority" becomes a tooltip on the handle, not body text.

### 5.3 Task detail (`04-task-detail--light.png`)

- **PageHeader:**
  - Breadcrumbs "My tasks › LR-20261101-A296".
  - The title is the task title in 22px Inter; long titles clamp to 2 lines. The ID moves to the
    breadcrumb and a copy button.
  - Outcome actions: **one primary** (the default outcome, e.g. "Complete") and the other outcomes as
    secondary buttons. Refresh and Escalate move into the `⋯` menu.
- **Meta strip:** a 4-column description list (label 12px muted, value 13px/500). Priority uses the
  icon form and Status uses StatusPill (today it reads "Todo").
- **Effort:** the 4 estimate tiles become one compact "Effort" Card with an inline `tnum` grid. "Click
  to edit" becomes an inline editable affordance (dotted underline on hover). Collapse "Execution plan"
  into this card.
- **Floating timer** (bottom-right 0:00): attach it to the effort card header as a Button sm "Start
  timer". When running, show a pill in the top bar instead of a floating card that overlaps content.
- **Layout:** main column 720px plus a right rail of 320px for Dependencies, Followers and Activity.

### 5.4 Workflows list (`05-automations-list--light.png`, `44-new-automation-dialog--light.png`)

- **Header:** "Workflows". The primary button is "New workflow" (not "New Automation"), with
  secondary "Import". Remove the MCP banner.
- **Toolbar:** per §3.16. Status (All/Active/Inactive) as a SegmentedControl; Triggers and Tags as
  FilterButtons; sort Select; view toggle; count.
- **Card:**
  - Padding 16px, with no empty left indent: the hidden checkbox column is removed and the checkbox
    appears on hover top-left.
  - Title 14px/600, 2-line clamp.
  - Trigger as a Tag. Status as a StatusPill top-right.
  - Meta "11 nodes · 49 runs · Last run today" in 12px muted `tnum`, with correct plurals.
  - Footer: "Run" (secondary sm) plus an overflow `⋯` with Form link, Export, Map and Tags.
  - The `interactive` card variant.
- **Default view: list (Table)** for more than 12 items, and remember the choice. Rationale: 62
  workflows in cards means scrolling through 21 rows of cards.
- **Dialog:** "New workflow" becomes Dialog md with sentence-case labels and 32px controls.

### 5.5 Workflow designer (`06-workflow-designer--light.png`, `06b-designer-node--light.png`)

- **One toolbar row, 48px**, replacing two rows of 15 buttons:
  - Left: back, name (16px/600, inline-editable), StatusPill "Active", Tag "v1 published", and the
    "Unpublished changes" dot.
  - Centre: Undo/Redo (IconButtons), then Tidy and Canvas/Load canvas collapsed into a "Layout ▾"
    menu.
  - Right: "Save" (secondary, ⌘S), "Test" (secondary, ⌘↵), "Publish v2" (primary), then `⋯`
    (Permissions, History, Export, Form link, View runs, Delete).
  - Stats (11 nodes · 12 edges · 10 runs · Ready to deploy) move to a 28px **status bar** at the
    canvas bottom. "4 live instances on older versions" becomes a Banner notice under the toolbar
    with a "Migrate…" action.
- **Panels:**
  - Default layout: palette (240px, collapsible to a 48px icon rail) | canvas (flex) | inspector
    (360px).
  - The **Data panel is a tab inside the inspector**, not a fourth column. The canvas must keep at
    least 60% of the width at 1440px.
  - Inspector tabs: "Configure · Data · Variables". With nothing selected, it shows workflow settings,
    so the webhook empty state moves there.
- **Nodes:**
  - The header colour comes from a **category token**, not Tailwind hex. Define
    `--ds-node-trigger`, `--ds-node-action`, `--ds-node-logic`, `--ds-node-human`, `--ds-node-ai`,
    `--ds-node-end`, mapped to theme chart slots 1–6 through the chart-palette resolver, so themes
    recolour nodes.
  - `lib/workflow-schema.ts` keeps `color` only as a legacy fallback, and the node catalog gets
    `category`.
  - Node body: `panel` background, 1px `border`, radius md, `elev-1` when selected plus a 2px primary
    outline. Title 12px/600; meta 11px muted. Handles are 8px with a `panel` ring.
- **Canvas:** dot grid 16px in `border-subtle` at 50%. Zoom controls: a bottom-left vertical
  IconButton group with `elev-2`. Minimap: bottom-right, 160×100, collapsible.
- **Palette items:** 32px rows (icon 16 + name 13px). The description moves into a tooltip, which
  removes the 3-line descriptions.

### 5.6 Run view (`07-workflow-runs--light.png`, `07b-run-detail--light.png`)

- **PageHeader:** breadcrumbs "Workflows › Website feedback received › Run 84117d70". StatusPill next
  to the title. Follow is a ghost button.
- **KPIs:** one StatCard row in the compare variant (§3.9), which removes the second "Compared With
  Typical Run" card of nested tiles.
- **Tabs:** "Process · Compare · Variables · Logs 4" become underline Tabs.
- **Canvas:** the same node styling as the designer. Completed nodes get a success 2px outline and a
  check badge; failed nodes get danger; the current node gets a pulsing primary ring (static when
  reduced-motion is set).
- **Runs list:** a Table with StatusPill, started (relative, with a tooltip), duration (right, `tnum`)
  and trigger.

### 5.7 Forms library (`08-forms-library--light.png`)

- **Header:** "Forms". Primary "New form", secondary "Import". "Form themes" becomes a **Tab**
  (Forms · Themes), not a black segment.
- **Toolbar:** search plus Tags/Theme/Used-by FilterButtons. **Remove the tag cloud.**
- **Row (Table):**
  - Star, then name (500) and version Tag, then the description in a secondary line, then fields
    (`tnum`), used by, theme and updated.
  - Actions: **"Open" (secondary sm) + "Edit" (ghost sm) + `⋯`** (Copy link, QR code, Submissions,
    Duplicate, Settings, Export, Delete). Nine buttons become three.
  - The expand chevron is removed. Details open in a Sheet.

### 5.8 Form designer (`09-form-designer*--light.png`)

- **Dialog full:** header 56px. Title "Vendor application" (16/600) with "Version 2" as a Tag. The
  explanatory sentence moves into an info tooltip.
- **Mode switch:** Design/Preview as a SegmentedControl. Panel toggles become IconButtons with
  tooltips.
- **Field palette:** 28px rows, grouped under 11px sentence-case labels ("Text", "Numbers & dates"…),
  with a search field at the top.
- **Canvas:**
  - Rows are drawn as flat `inset` wells, not nested cards. The row toolbar (column count 1–4, move,
    add, delete) appears on hover or focus.
  - Column count uses a SegmentedControl xs.
  - Field cards: 1px border, radius sm, title 13/500, key in mono 11px muted.
- **Inspector tabs:** "Field · Step · Header · Rules 14 · Data · Theme · Checks 86" as underline Tabs
  with CountBadges. They never wrap; they scroll with fade masks. Rename "Buttons & header" to
  "Header" and "WCAG 86" to "Checks", with a score badge.
- **Footer:** the left side shows "No changes" or "3 unsaved changes" (12px muted with a dot). The
  right side shows Cancel (ghost) and "Save version 3" (primary).

### 5.9 Runtime form `/f/`, `/p/` and Submitted (`10-form-runtime--light.png`)

These pages are themed by **form themes** and must stay that way. Only adopt the following:

- Inter as the default face (a form theme font overrides it).
- Focus ring per §2.8 using the form palette's ring.
- 40px controls, radius from the form theme.
- Remove the double frame. Today a green-tinted outer panel wraps a bordered card. Make it one card
  (`elev-1`, radius lg) on the canvas.
- The progress bar becomes a 4px bar under the step label, with "Step 1 of 4 · Company details" as
  12px muted, and "25%" removed.
- Primary button: the form theme's button colour; 40px; right-aligned; "Next" with a 16px chevron.
- **Submitted page:** keep the existing motion (it already respects reduced motion). Use the Fraunces
  display title here, as the one brand moment.

### 5.10 Data tables (`11-data-list--light.png`, `12-data-table--light.png`, `13-data-schema--light.png`)

- **List:** a Table (name, rows `tnum` right-aligned, columns, retention, updated).
- **Table page:**
  - PageHeader: a 32px icon tile, the name, and the description (clamped to 2 lines with "more"). The
    meta (17 columns · 32 rows · Updated 4 days ago · No retention policy) goes on one 12px muted line.
  - Tabs "Rows 32 · Schema 17 · Access".
  - Remove the "Table data" intro card and the right-aligned helper sentence.
- **Grid:**
  - Single-line cells (truncate plus tooltip) at row height 40.
  - Number columns right-aligned with `tnum`; dates `tnum`; booleans as a 16px check or dash, centred.
  - The row ID column is mono 12px muted.
  - The "New" inline-entry row becomes a "+ Add row" button below the header (sticky), which opens a
    row Sheet. Inline add stays available via a keyboard shortcut.
  - Column headers wrap to 2 lines at most (12px/500) with a type icon (14px muted).
  - Sticky header and first column, horizontal scroll shadow.

### 5.11 Reports (`14-reports--light.png`, `15-report-detail--light.png`, `15b-reports-workflows--light.png`)

- **Hub:** Tabs "Workflows · People · General", replacing the black segment. The period Select moves
  into the PageHeader actions.
- **KPI grid:** an auto-fit StatCard grid (no orphan row). Lead with 4 KPIs: Runs, Active, Errors and
  p50 duration. Move node visits and edge traversals into the Compare page.
- **Highlight cards** ("Busiest workflow"…): one consistent card with equal heights. No 2px dark
  borders; the value goes in a neutral CountBadge.
- **Anomaly cards** ("Duration spike") with no anomaly: collapse into one muted line, "No anomalies
  in the last 90 days", instead of two empty cards.
- **Charts:**
  - All charts use the chart-palette resolver (theme chart tokens). Report `style.colors` that equal
    the old default blue are ignored.
  - Bar max width 48px with gaps ≥ 30% of the band. A single category renders as a single
    48px-wide bar, not a full-width slab.
  - Gridlines: horizontal only, `border-subtle`, dashed off. Axis ticks 11px muted `tnum`; no axis
    lines except the baseline.
  - Tooltips use the Tooltip surface (`elev-2`). Legends are 12px with a dot and a label, placed top
    left.
  - Every chart has a "Table" toggle (as Home does).
- **Report detail:** the PageHeader with Edit (secondary), Export (menu), and `⋯` for Export
  definition, Share, Unpin and Delete. The "1 row" table becomes a Table.

### 5.12 Integrations and connectors (`16-integrations--light.png`, `17-integration-detail--light.png`, `45-integrations-new--light.png`)

- **Header:** "Integrations"; "New integration" (primary), with Import and Import API merged into one
  "Import ▾" menu. Remove the MCP banner and the `?` circle; the docs link goes in the description.
- **Tabs:** Integrations 25 · References 23 · Connectors · Objects · MCP servers. These are underline
  Tabs in the PageHeader, not a black segment beside search.
- **Card:**
  - A 32px logo or initial tile, then the name (14/600), then the type plus host in mono 12px muted.
  - StatusPill. Meta "1 reference" (fixed plural).
  - Tags only if present. Remove the stray "+".
  - Equal heights with no dead space; the min-height is the content height.
- **Custom reference builder:** a Sheet lg with Field anatomy, a request preview in a mono well
  (`inset`), and a "Test" button with the response shown in a collapsible JSON viewer (mono 12, line
  numbers).

### 5.13 Agents (`18-agents--light.png`, `19-agent-detail--light.png`)

- Align the header and toolbar with Workflows. The primary "New agent" moves to the header. "Costs &
  budgets" becomes a Tab, not a lone button.
- **Card:**
  - Remove the checkbox column (select appears on hover).
  - Model as a mono Tag. StatusPill `success`, replacing the emerald pill.
  - Footer actions in `⋯`. The red "Delete" text link moves into the menu.
- **Pagination:** inline in the toolbar count, not in a separate full-width card.

### 5.14 Settings (`20-settings--light.png`, `21-settings-theme--light.png`, `22-…`, `23-…`, `24-…`, `31-…`)

- **Layout:** a 2-column frame, with a 200px sub-nav plus content at max 720px, filling the canvas
  (not a 550px card floating in 1180px).
- **Sub-nav:** sections "Account" (Profile, Appearance, Preferences), "Workspace" (General, Theme,
  Forms, Organizations, Members & invites), "Security" (Governance, SSO & directory, API keys, OAuth
  apps), "Developers" (Webhooks, MCP, GitHub sync, Log export, Live logs) and "Infrastructure"
  (Document OCR, Infrastructure, Packages).
  - Items are 32px, with no chevrons.
  - The main-sidebar "Admin" duplicates are removed (Retention and Packages each live in one place).
- **Pages:** each setting page is a stack of **SettingsSection** blocks. A section has a title (16/600)
  and description (13 muted) in a 240px left column, the controls on the right, and a
  `border-subtle` divider between sections. Rationale: the Stripe and Vercel settings pattern.
- **Saving:** a sticky bottom save bar when the form is dirty ("Unsaved changes · Discard · Save"),
  replacing per-card "Save Changes" buttons.
- **Theme designer:**
  - The preview is the hero. Accordions follow the Field spec.
  - The template grid uses the `interactive` card with a 2px primary outline when selected.
  - Add a "Density" SegmentedControl (now functional).
  - The "Save for workspace" disabled state must read as disabled (the current grey fill looks
    enabled).
- **Governance:** remove nested cards in the role cards. Each role row becomes a Table row (Role, Users,
  Permissions, Retention, actions), with the role detail in a Sheet.

### 5.15 Gallery (in-app `/packages`, public `/gallery`)

- **In-app Packages:** a Table (name + version Tag, source in mono 12 muted, signed Badge, installed
  relative date, StatusPill). Upgrade, Details and History go in `⋯`. The drop zone shrinks to a
  32px dashed "Drop a .utpkg or choose a file" line inside the toolbar.
- **Public `/gallery`:**
  - It uses the marketing frame (§5.16).
  - Cards are 16:10 previews with `elev-1` on hover, a title (15/600) and a one-line description.
  - Filters use the same SegmentedControl and Tags.
  - **The controls frames** (`/gallery/controls/[slug]` iframes) must keep their form-theme isolation.
    Do not apply the app's global rules inside the frame (see §10).

### 5.16 Marketing landing and docs (`50-landing--light.png`, `51-docs--light.png`, `56-docs-page--light.png`)

- **Type:** the hero is Fraunces `text-display`, and everything else is Inter. Body is 17px/28px on
  marketing (the one place above 16px).
- **Hex literals:** the 1,000+ hex literals in `components/marketing/*` become a marketing token block
  (`.mkt` scope) that aliases the same neutral and brand tokens. Visual output is unchanged where values
  match. Rationale: one palette to maintain.
- **Screenshots:** use the same frame everywhere: radius lg, `elev-3`, a 1px border, and a fake
  window bar of 28px.
- **Docs:**
  - A 3-column layout: nav 240, content max 720, and a 200px "On this page" rail.
  - Code blocks in JetBrains Mono 13px, with a copy button and a language tag.
  - Callouts use InlineNotice tones.
- **Login and signup** (`54-login--light.png`, `55-signup--light.png`). These are already among the
  calmest pages, so keep the two-column layout.
  - The headline stays in Fraunces (public brand moment). The feature tiles drop their translucent
    boxes and become a simple icon + label list.
  - Fields per the Field spec, 40px. The primary button is full width.
  - SSO buttons are secondary, full width, with a provider icon.
  - Helper and footer text in `fg-muted` (today it is accent-brown).
  - Remove `abyss-auth` `!important` overrides once the page uses tokens.

### 5.17 Activity, Team, Rules, Queue, Extensibility (`26`–`30`)

- These use the same PageHeader, Table, Tabs and EmptyState. No bespoke layouts.
- The Activity feed groups by day: a 12px muted sticky header per day, then rows (avatar 24, actor 500
  + action + object link, and a right-aligned relative time with a tooltip).

### 5.18 Mobile (`*--light-390.png`)

- **Shell:** the top bar (48px) with a hamburger opening the sidebar as a left Sheet (280px). Search
  becomes an icon that opens the palette full-screen.
- **Tables:** below 640px, tables collapse to stacked list rows. Each row shows the title (500), a
  secondary line, and a right-aligned status or value. The Table primitive offers a `mobile="list"`
  render.
- **PageHeader:** actions collapse to the primary plus `⋯`. Tabs scroll horizontally.
- **Touch:** controls are at least 40px on coarse pointers (§2.10).

---

## 6. Micro-polish checklist

Each workstream verifies this list for its pages.

- [ ] **Truncation:** single-line `truncate` on names, cells and breadcrumbs, with a Tooltip showing
  the full text when truncated (`useIsTruncated` helper). Use a 2-line clamp only for card titles and
  descriptions.
- [ ] **Numbers:** `Intl.NumberFormat` via `lib/format/number.ts`: `formatCount`, `formatPercent`
  (0 dp ≥10%, 1 dp <10%), `formatCurrency` (the record's currency) and `formatDuration` (ms → "12 ms",
  "4.2 s", "3 m 10 s", "12.7 h", "3 d"). Use `tnum` wherever numbers stack.
- [ ] **Plurals:** use `Intl.PluralRules` via `plural(n, 'run')`. Fix "1 runs", "1 references", "1
  tools" and "1 nodes".
- [ ] **Dates:** `lib/format/date.ts`:
  - Relative ("5 min ago", "Yesterday", "3 days ago") within 7 days, then "27 Oct" for this year and
    "27 Oct 2025" otherwise.
  - Absolute on hover (Tooltip: "Tue 27 Oct 2026, 14:05 NZDT").
  - The workspace timezone is shown once in the header, not in every chart caption.
  - Never `toLocaleString()` raw (the Theme header "11/4/2026, 1:14:12 PM").
- [ ] **Loading transitions:** skeletons after 150ms; content cross-fades in; buttons show inline
  spinners; no layout shift (reserve heights).
- [ ] **Optimistic updates:** star/favourite, status changes, rename, reorder and toggles update
  immediately with a rollback toast on error (react-query `onMutate`).
- [ ] **Hover affordances:**
  - Interactive cards: border-strong plus `elev-1`.
  - Rows: the `subtle` background.
  - Row actions revealed on hover or focus.
  - Links underline on hover only.
- [ ] **Cursor states:** `pointer` on clickable rows and cards; `grab`/`grabbing` on drag handles;
  `not-allowed` on disabled; `text` on inline-editable values; `col-resize` on column resizers.
- [ ] **Scroll shadows:** horizontal tables, dialog bodies, the sidebar nav, inspector panels and tab
  overflow use a 12px gradient mask from `panel` to transparent (`.ds-scroll-shadow`, a CSS-only
  scroll-driven animation with a JS fallback).
- [ ] **Keyboard hints:** `Kbd` in tooltips and menus (⌘K search, ⌘S save, ⌘↵ test, `N` new, `/`
  focus search, `?` shortcut sheet). A `?` opens a shortcuts dialog listing them.
- [ ] **Copy tone:**
  - Sentence case everywhere: buttons, tabs, headers, menu items and table headers.
  - Buttons start with a verb ("Create task", "Save changes", "Publish v2").
  - No trailing periods in labels.
  - Use "…" only on actions that open a further step ("Import…").
  - Terminology: "Workflow" (not "Automation") for the object; "Packages" in-app and "Gallery"
    publicly, linked by "Browse gallery".
- [ ] **Empty, error and success states** exist for every list, panel and chart.
- [ ] **Favicon and tab titles** per §4.5.
- [ ] **404 and 500** pages per §4.5.
- [ ] **Selection colour:** `::selection { background: var(--theme-primary-light); }`.
- [ ] **Scrollbars:** thin 8px, thumb `border-strong`, track transparent (`scrollbar-width: thin;
  scrollbar-color`).
- [ ] **Images and avatars** get a 1px `border-subtle` ring so white logos don't bleed into white cards.

---

## 7. Accessibility checks to keep

- **Contrast:**
  - Text needs ≥4.5:1 (≥3:1 for ≥18.66px bold or 24px).
  - UI boundaries and focus rings need ≥3:1 against adjacent colours.
  - `lib/theme/legibility.ts` already enforces this for theme tokens. **Add** `--ds-border-strong`,
    `--color-fg-subtle` (placeholder ≥4.5:1 is not required, but disabled text must stay legible at
    3:1) and StatusPill text-on-wash to its checks. Unit-test them in `__tests__/` for all 43 presets ×
    2 modes.
- **11px floor:** nothing smaller. That is the reason for removing `text-[7–10px]`.
- **Focus:** always visible via `:focus-visible` (§2.8). Never `outline:none` without a replacement.
  Tab order follows visual order. Dialogs trap focus and return it to the trigger. Menus and tabs use
  roving tabindex.
- **Targets:** ≥24×24px (WCAG 2.2 AA), and ≥40px on coarse pointers.
- **Status:** never colour alone. Pills carry a label; priority carries an icon and a label; charts
  carry a legend, direct labels and a table view (already the Home approach).
- **Motion:** honour `prefers-reduced-motion` (§2.9).
- **Labels:** IconButton requires `label`. Inputs require a Field label or `aria-label`. Toasts use
  `role=status`.
- **Regression:** keep the existing WCAG checks in the form designer ("Checks" tab) and the
  `seo-foundation` and a11y tests green.

---

## 8. Implementation plan

Six workstreams. **A lands first.** It is additive: new tokens, new primitives, and old primitive
APIs kept as aliases, so B–F can start as soon as A's PR merges. B–F own disjoint directories and only
*consume* `components/ui` (no edits there; they request changes from A).

Shared rules for every workstream:

- Replace inline `style={{ color/backgroundColor/borderColor: 'var(--theme-…)' }}` with semantic
  utilities (`text-fg-muted`, `bg-panel`, `border-border`) in every file touched.
- Apply the §2.2 codemod to text sizes in owned files.
- No new hex literals. A lint rule enforces this (`no-restricted-syntax` on `/#[0-9a-f]{6}/i` in
  `className` and `style`, warn-only outside marketing and gallery).
- Update docs screenshots for owned surfaces (§10) in the same PR.
- `npx tsc --noEmit`, `npm run test` and `npm run build` must pass. Capture before and after shots at
  1440 light, 1440 dark and 390 light.

### A. Foundations: tokens and primitives (lands first)

- **Owns:**
  - `app/globals.css`
  - `app/layout.tsx` (fonts and title template)
  - `lib/theme/fonts.ts`, `lib/theme/presets.ts`, `lib/themes.ts` (preset typography, shape, chrome
    and chart retune), `lib/theme/to-css.ts` (elevation and density emission),
    `lib/theme/legibility.ts` (new checks)
  - `components/ui/**` (all new and rewritten primitives)
  - `lib/format/**` (new number, date and plural helpers)
  - `supabase/migrations/<ts>_theme_defaults_refresh.sql` (stored-theme migration, §9)
  - `eslint.config.mjs` (hex and arbitrary-size rules, warn-only)
  - `__tests__/theme-*.test.ts` and new `__tests__/ui-primitives.test.tsx`
- **Order:**
  1. Tokens in globals.css: `--ds-*`, semantic colours in `@theme inline`, `text-2xs`, `text-ui`,
     `text-title`, `text-metric`; radius mapping; elevation; motion; focus; `svg.lucide` stroke;
     skeleton fix; reduced motion.
  2. Fonts: Inter and JetBrains Mono via `next/font`; `fonts.ts` bundledVar swap; preset typography.
  3. New primitives: IconButton, Field, Textarea, Select, Checkbox, Switch, Tabs, SegmentedControl,
     Badge/StatusPill/Tag/CountBadge, Table, StatCard, PageHeader, Dialog, Sheet, DropdownMenu,
     Popover, Tooltip, Toast, Kbd, Avatar, Skeleton.
  4. Rewrite Button, Input, Card, EmptyState, InlineNotice, ConfirmDialog, list-controls, ProgressBar
     and page-skeleton with **back-compatible props** (`variant="default"|"outline"` aliases, the
     `StatusBadge`/`RunStatusBadge`/`PriorityBadge` exports kept and re-implemented on Badge).
  5. Wire density (`to-css.ts` emits `--ds-control-h` and `--ds-nav-item-h` per density).
  6. **Do not delete** the globals.css compatibility overrides (`.text-gray-*`, `[class*="bg-white"]`
     and so on) yet. Move them to a clearly fenced `/* LEGACY COMPAT — remove when B–F land */` block.
     **Do** replace the `rounded-*` `!important` overrides with the @theme radius mapping (pages render
     with the new radii immediately).
  7. Stored-theme migration plus a preset retune of chart colours to pass the chart-palette floors.
  8. A Noir-derived `dark` palette for Gallery and Atelier (run through `legiblePalette`). Verify
     "Follow device" renders dark on Home.
- **Risk:**
  - The radius change and Button height (40→32) shift every page at once. That is intended, but check
    the form runtime (§10) and the designer canvas hit areas.
  - Font swap metrics: Inter is wider than DM Sans at the same size, so check truncation in the
    sidebar and tables.
  - Theme legibility tests must still pass for 43 presets.
- **Acceptance:**
  - All primitives render in light and dark for **Gallery, Noir/Night-drive, Nebula Teal and one
    custom theme** on a scratch `/dev/ui` page (dev-only, `notFound()` in production) that serves as
    the living style guide.
  - Skeletons visibly shimmer. Focus rings are visible on every primitive.
  - No component in `components/ui` uses inline `style` for colour.
  - `rg "text-\[(7|8|9|10)px\]" components/ui` returns nothing.
  - Theme designer's density control changes table row height.

### B. App shell, global chrome and public frame

- **Owns:**
  - `components/layout/**`
  - `components/jobs/**` (toast rendering)
  - `components/onboarding/**`
  - `app/(dashboard)/layout.tsx`, `app/(dashboard)/loading.tsx`
  - New `app/not-found.tsx`, `app/(dashboard)/not-found.tsx`, `app/(dashboard)/error.tsx` and
    `app/global-error.tsx`
  - `app/(auth)/**`, `components/brand/**`
  - `app/icon.svg` / favicon assets
- **Order:**
  1. Sidebar regroup plus the new item styles.
  2. Top bar with breadcrumbs (a `BreadcrumbsProvider` that PageHeader feeds).
  3. "+ New" menu absorbing the header Forms dropdown.
  4. Command palette on cmdk.
  5. Notifications panel; toasts.
  6. Error and 404 pages; metadata title template, with per-route `metadata` *helpers* exported from
     `lib/page-title.ts` for other workstreams to call.
  7. Auth pages.
- **Risk:**
  - Nav regrouping changes muscle memory, so keep every route and add redirects for none (URLs are
    unchanged).
  - `sidebar-nav-item.tsx` active-route logic is subtle (query-scoped routes), so keep the logic and
    change only the styling.
  - The anonymous `/p/` pages must not get the dashboard shell.
- **Acceptance:**
  - Breadcrumbs on every dashboard page.
  - ⌘K palette with keyboard footer.
  - No red count unless overdue.
  - Custom 404 and error boundary verified by visiting `/nope` and by throwing in dev.
  - Tab titles are unique per route.
  - Mobile Sheet nav at 390px.

### C. Home and Tasks

- **Owns:**
  - `components/home/**`, `components/tasks/**`, `components/activity/**`, `components/team/**`
  - `app/(dashboard)/home/**`, `app/(dashboard)/tasks/**`, `app/(dashboard)/activity/**`,
    `app/(dashboard)/team/**`
  - `lib/home/**` (chart palette consumers only)
- **Order:**
  1. PageHeaders.
  2. Home StatCards and compact bars.
  3. Home tabs and table.
  4. Tasks list → Table (remove the `timesheet-helpers` header colours).
  5. Task detail layout, action hierarchy, effort card and timer relocation.
  6. Activity feed grouping; Team table.
- **Risk:**
  - The home grid (`.home-grid` CSS in globals) is owned by A's file. C needs changes there, so
    **move that block to `components/home/home-grid.css`** in C's first PR. A must not touch it after
    the handoff.
  - Drag-to-reorder tasks must keep working.
  - The Calendar view.
- **Acceptance:**
  - `01`, `03` and `04` re-shot show one table style.
  - No hex in `components/tasks`.
  - Overdue uses danger text only.
  - Priority uses icon plus label.
  - The Home charts take theme colours (no reference blue fallback) on the Gallery preset.

### D. Automations: workflows, designer, runs, rules, schedules, queue, agents

- **Owns:**
  - `components/automations/**`, `components/business-rules/**`, `components/email-templates/**`,
    `components/agents/**`, `components/topology/**`
  - `app/(dashboard)/automations/**` **except** `automations/forms`
  - `app/(dashboard)/agents/**`, `app/(dashboard)/extensibility/**`, `components/extensibility/**`
  - The `color`/`category` fields in `lib/workflow-schema.ts` (that field only; coordinate with tests
    `workflow-schema`)
- **Order:**
  1. The Workflows list (cards and table, toolbar).
  2. The designer toolbar consolidation and status bar.
  3. Panel layout (Data into the inspector).
  4. Node category tokens and node styling (designer plus `runtime-canvas` / `process-viewer`).
  5. Run detail and runs list.
  6. Queue, Schedules, Rules and Email templates pages onto PageHeader and Table.
  7. Agents list and detail.
- **Risk:**
  - The designer is the most complex surface: keyboard shortcuts, drag and drop, the
    `[data-drop-target]` CSS in globals (leave it in A's file and don't restyle it).
  - React Flow node sizes affect the stored layout, so **do not change node dimensions**, only their
    visual style.
  - `workflow-schema` golden tests and MCP description tests reference the node catalog, so add
    `category` without removing `color`.
- **Acceptance:**
  - The canvas has ≥60% width at 1440px.
  - One toolbar row.
  - Node colours follow the theme (check Nebula Teal and Gallery).
  - Save & Test, Publish and History all reachable via buttons, `⋯` or shortcuts.
  - Run view without nested KPI cards.

### E. Forms: library, designer, runtime, themes

- **Owns:**
  - `components/forms/**` (including `designer/**`)
  - `app/(dashboard)/automations/forms/**`, `app/(dashboard)/f/**`, `app/p/**`, `app/form-controls/**`
  - `lib/forms/**` (theme scoping, submitted page)
- **Order:**
  1. Forms library rows and the actions collapse.
  2. Designer dialog chrome, palette, canvas rows and inspector tabs.
  3. Runtime card frame and progress.
  4. Form themes list as a Tab.
  5. Submitted page typography.
- **Risk:**
  - **Form themes must keep total control of the runtime look.** Every token the runtime consumes must
    come from `form-theme-scope` variables first, then the app tokens.
  - `[data-form-theme]` placeholder and ring-offset rules in globals stay.
  - `/p/` anonymous pages run without the dashboard theme bootstrap (the regex in `layout.tsx`).
  - The gallery controls iframes render form controls, so verify `/gallery/controls/*` after each
    change.
- **Acceptance:**
  - Library rows have ≤3 visible actions.
  - Designer tabs never wrap at 1280px.
  - Runtime renders identically for a custom form theme except for the documented changes (single
    frame, font default, focus ring).
  - Anonymous `/p/<token>` works signed out.

### F. Data, reports, integrations, settings, gallery and marketing

- **Owns:**
  - `components/data/**`, `components/reports/**`, `components/integrations/**`,
    `components/connectors/**`, `components/settings/**` (including `theme-designer/**`),
    `components/governance/**`, `components/api-keys/**`, `components/admin/**`,
    `components/packages/**`, `components/gallery/**`, `components/marketing/**`, `components/docs/**`,
    `components/shared/**`
  - `app/(dashboard)/{data,reports,integrations,settings,packages,onboarding}/**`,
    `app/(marketing)/**`, `app/docs/**`
- **Order:**
  1. Data grid (highest visible impact).
  2. Reports hub, charts and detail.
  3. Integrations list, detail and the reference builder.
  4. The Settings frame plus SettingsSection, then governance, theme designer (density control) and
     the OCR and Infrastructure pages.
  5. In-app Packages.
  6. Public gallery and marketing token block.
  7. Docs layout.
- **Risk:**
  - The marketing hex migration is large but mechanical. Keep visual parity and verify with
    screenshot diffs.
  - `docs-abyss` and `abyss-auth` overrides live in globals (A). F asks A to delete them once
    marketing and docs use tokens.
  - The theme designer previews themes, so it must render the **preview** with the theme being edited,
    not the workspace theme (the existing behaviour; don't regress it).
- **Acceptance:**
  - Data rows are 40px with right-aligned `tnum` numbers.
  - Reports use theme chart colours with no orphan KPI rows.
  - Settings content fills its column, with a sticky save bar.
  - The MCP banner appears in one place only.
  - Public pages are unchanged in structure, with tokens adopted.

**Final cleanup** (A, after B–F merge):

- Delete the `LEGACY COMPAT` block in globals.css.
- Promote the lint rules from warn to error.
- Delete the `default`/`outline` Button aliases.
- Re-run all screenshots.

---

## 9. Migration notes (fonts, themes, screenshots)

| Change | Who sees it | Handling |
|---|---|---|
| Default UI font DM Sans → **Inter**; mono Space Mono → **JetBrains Mono** | Every workspace on a built-in preset; signed-out pages | Presets updated in code. **Stored themes:** migration `…_theme_defaults_refresh.sql` rewrites `workspace_themes.theme` (the only workspace-theme store; form themes live in `forms.theme` / `form_versions.theme` and are **not** touched) **only where** `typography.sans = {source:'google',family:'DM Sans'}` **and** `typography.mono.family = 'Space Mono'` (the untouched platform defaults) to Inter / JetBrains Mono, and records the old values in `theme->'meta'->'migratedFrom'` for rollback. Themes that chose any other font are untouched. DM Sans and Space Mono stay selectable (served from Google). |
| In-app headings Fraunces → Inter | Workspaces on basecamp, trailside or night-drive (`headingFont: 'display'`) | The same migration sets `headingFont: 'sans'` where `basePreset ∈ {basecamp, trailside, night-drive}` and `display.family = 'Fraunces'`. Custom themes that picked a different display font keep it. The bootstrap default `theme_headings` becomes `sans`. |
| Default radii 12/8/8/16 → 8/6/6/12 | Built-in presets | Presets only. Stored custom themes keep their radii, because they explicitly chose them. |
| Cards flat (no shadow) | Everyone | `--theme-card-shadow` is no longer applied to cards by the global rule. Custom `shadows.card` is ignored for cards and documented in the theme designer help text. |
| Theme shadows not applied in dark mode | Custom themes with custom shadows | Platform dark elevation (§2.6). Documented in the theme designer. |
| Sidebar gradient and dot texture, canvas dots | Built-in presets | Removed from the default presets' `chrome`. Stored themes that carry them keep them. |
| Density now functional | Themes with `compact` or `spacious` | They now change row and control heights. That was the setting's intent. Mention it in release notes. |
| Gallery and Atelier gain a `dark` palette (Noir-derived) | Every workspace on those presets with `meta.mode: 'auto'` whose OS is dark | They now actually go dark. The migration adds `colors.dark` to stored themes whose `basePreset ∈ {basecamp, atelier}` and whose dark palette still equals their light palette (i.e. never customised). Release note: "Gallery now follows your device's dark mode; set Appearance → Always light to keep the old look." |
| Built-in `chart` palettes retuned | Charts and nodes on built-in presets | New values must pass the `chart-palette` floors on their card colour (add a test). Custom palettes untouched; the resolver still guards them. |
| Button 40 → 32px, Input 40 → 32px in the app chrome | Everyone | Form runtime stays at 40px. |
| Docs screenshots | `public/screenshots/*.webp` (104 files), referenced by docs and the marketing site | Re-shoot per workstream for its surfaces with the existing scratchpad shot scripts. Index the list in each PR. The workstream that changes a surface owns its screenshots. |

Apply the migration per `docs/migrations.md`: it is additive and idempotent, and keeps the rollback
data. **Not** to LIVE without the usual sign-off.

---

## 10. Regression risks

1. **Custom workspace themes:**
   - Everything colour-related derives from `--theme-*`, so recolouring keeps working.
   - The risk is in derived mixes (`--ds-border-strong`, `--color-subtle`) on extreme palettes such as
     pure-black cards or neon primaries.
   - **Test matrix:** Gallery, Night-drive (dark), Nebula Teal (decoration preset), Corporate Blue,
     and one custom high-chroma theme, each in light and dark.
2. **Form themes:**
   - `[data-form-theme]` scopes set their own `--theme-*` and `--form-*` variables.
   - The new global focus rule uses `--theme-focus-ring`, which the form scope already overrides.
     Verify that a form theme with a light background inside a dark workspace (and vice versa) keeps
     correct placeholder, ring and border colours.
   - Never put `!important` on new rules that could beat the form scope.
3. **Dark mode:**
   - Elevation, the `elevated` background, skeleton contrast, and StatusPill washes on dark cards.
   - The `dark:` variant keys off `data-theme-mode`, not the OS. Screenshots must set the theme mode,
     not just the colour scheme.
4. **Anonymous `/p/` pages and signed-out routes:**
   - They skip the theme bootstrap, so they render with the `:root` defaults (now Inter).
   - Verify `/p/<token>` with a form theme, the login page and the OAuth consent page.
5. **Gallery controls frames** (`/gallery/controls/[slug]`, `app/form-controls/**`):
   - They render form controls inside iframes with their own theme.
   - Global element selectors (`svg.lucide` stroke, focus rule, `::selection`, scrollbars) will apply
     inside them. Acceptable, but re-verify the control screenshots (`dyn-gallery-*` scripts).
6. **Global compat overrides:**
   - Removing `[class*="bg-white"]`, `.text-gray-*` and similar too early will turn unmigrated pages
     white-on-dark. Keep them until the final cleanup.
   - The `rounded-*` replacement in A changes radii everywhere at once (intended). Check that no
     component relied on `rounded-xl` being 12px for layout, such as circular badges built with
     `rounded-xl`.
7. **Fonts:**
   - Inter's metrics are wider than DM Sans, so fixed-width columns (designer palette, node cards,
     sidebar 240px, Kanban/calendar cells) may truncate.
   - Fraunces stays loaded, at a cost of about 30 KB, but only marketing uses it. Consider
     `preload: false` for Fraunces in the dashboard.
8. **Docs screenshots and marketing images** (`public/screenshots`, gallery previews, OG images in
   `app/opengraph-image.tsx`) will be visually stale until re-shot. The OG image uses its own fonts, so
   update it to Inter in B.
9. **Tests:**
   - `seo-foundation` (titles), `workflow-schema` (node catalog `color`), MCP golden descriptions (if
     catalog text changes), and theme legibility tests.
   - Add `ui-primitives` render tests and a preset × mode contrast test for the new derived tokens.
10. **Designer layout persistence:** node dimensions and canvas positions are stored, so styling must
    not change node box sizes (D's acceptance criterion).

---

## 11. Decisions requiring no further input (made per the brief), and the few worth a glance

Made, with rationale above:

- Inter + JetBrains Mono, with Fraunces for marketing only.
- Comfortable density by default (40px rows, 32px controls).
- Flat cards with elevation only for floating layers.
- Neutral-first colour with a single primary action per region.
- Nav regrouped into Build / Operate / Govern.
- "Workflow" as the object name.
- No new UI dependencies (Radix dialog, dropdown and tooltip, and cmdk, are already installed).

Worth a glance by the product owner (the spec proceeds with the stated default unless told otherwise):

- **Brand texture.** The dot canvas and sidebar texture are removed from the default presets. They
  are a recognisable brand trait of the current "Gallery" look. Default: remove, for calm.
- **Ink-black primary.** The Gallery preset's primary is near-black `#17150F`, with gold accent
  `#B08A54`. Default: keep it. Black primary buttons read as premium, like Vercel. Gold becomes a
  brand-moment accent only.
- **Stored-theme migration** of the font defaults (§9). Default: migrate untouched defaults only.
- **Default theme goes dark with the OS.** Gallery on "Follow device" will turn dark for dark-OS users
  once it has a dark palette. Default: yes. That is what "Follow device" promises.
