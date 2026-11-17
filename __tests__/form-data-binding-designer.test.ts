/**
 * Data binding in the form designer (components/forms/designer/data-binding-panel.tsx):
 * the Data panel beside the Outline (grouped source fields, type icons,
 * required / read-only / new markers, search, on-the-form state, add all
 * missing, keyboard and screen-reader labels), the Data tab's source chooser
 * (locked for an extension target), a field's "Bound to", and the drop
 * zones that take a source field (grid, section foot, page chip).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/automations/forms/f1', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/app/actions/forms', () => ({ bindFormSource: vi.fn() }))

import { BoundToProperty, DataBindingSettings, DataSourcePanel, sourceMapping } from '@/components/forms/designer/data-binding-panel'
import { FormDesigner } from '@/components/forms/designer/form-designer'
import { designerStateFrom } from '@/lib/forms/designer-state'
import type { FormSourceState } from '@/lib/services/form-sources'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const TABLE = '0f000000-0000-4000-8000-00000000d001'

const state = designerStateFrom({
  fields: [{ key: 'customer', label: 'Customer', type: 'text', required: true }, { key: 'notes', label: 'Notes', type: 'textarea' }],
  layout: { rows: [{ columns: 1, cells: [{ field_key: 'customer', span: 1 }] }, { columns: 1, cells: [{ field_key: 'notes', span: 1 }] }], data_binding: { kind: 'table', source_id: TABLE, label: 'Customers', fields: { customer: 'name' } } },
  theme: { source: 'workspace' },
} as any)

const source: FormSourceState = {
  kind: 'table', label: 'Customers', bind: true, locked: false, writable: false,
  description: {
    title: 'Data table "Customers"',
    sourceFields: [
      { key: 'name', label: 'Name', typeLabel: 'Text', fieldTypes: ['text', 'textarea'], required: true, group: 'columns' },
      { key: 'credit', label: 'Credit limit', typeLabel: 'Number', fieldTypes: ['number', 'currency'], group: 'columns', isNew: true },
      { key: 'region', label: 'Region', typeLabel: 'Lookup', fieldTypes: ['lookup', 'text'], group: 'lookups', lookup: 'Regions' },
      { key: 'contract', label: 'Contract', typeLabel: 'File', fieldTypes: [], group: 'columns', help: 'File columns can\'t be bound to a form field yet.' },
      { key: 'row_id', label: 'Row id', typeLabel: 'Row id', fieldTypes: ['text'], readOnly: true, group: 'system' },
    ],
    mappings: [{ field: 'customer', source: 'name' }, { field: 'notes', source: null }],
    notes: [],
  },
}

function panel(over: Partial<Parameters<typeof DataSourcePanel>[0]> = {}) {
  return renderToStaticMarkup(createElement(DataSourcePanel, {
    state, source, loading: false, error: null, mapping: sourceMapping(state, source), selectedId: null, busy: false,
    onSelectField: () => {}, onAdd: () => {}, onChooseSource: () => {}, ...over,
  }))
}

describe('the Data panel', () => {
  it('lists every source field grouped (columns, lookups, system), with markers', () => {
    const html = panel()
    expect(html).toContain('Data table &quot;Customers&quot;')
    const groups = [...html.matchAll(/id="data-group-([a-z]+)"/g)].map((m) => m[1])
    expect(groups).toEqual(['columns', 'lookups', 'system'])
    expect(html).toContain('data-source-field="credit"')
    expect(html).toContain('data-source-new=""')
    // Required marker and read-only source fields.
    expect(html).toMatch(/data-source-field="name"[\s\S]*?text-danger[^>]*>\*</)
    expect(html).toMatch(/aria-label="Add Row id \(Row id, read only\) to the form"/)
  })

  it('a field already on the form shows as bound and selects it; others add (drag, click or Enter)', () => {
    const html = panel()
    expect(html).toMatch(/aria-label="Name, Text, on the form as &quot;Customer&quot;: select it"[^>]*aria-pressed="false"/)
    expect(html).toContain('data-on-form="customer"')
    expect(html).toMatch(/draggable="true"[^>]*aria-label="Add Credit limit \(Number\) to the form"/)
    // A source field that can't be bound is shown, explained, and inert.
    expect(html).toMatch(/aria-disabled="true"[^>]*aria-label="Contract \(File\) can&#x27;t be added: File columns/)
  })

  it('"Add all missing fields" counts what is bindable, editable and not yet on the form', () => {
    expect(panel()).toContain('data-add-all-missing')
    expect(panel().replace(/<!-- -->/g, '')).toContain('Add all missing fields (2)')
    expect(panel({ readOnly: true })).not.toContain('data-add-all-missing')
  })

  it('says plainly when the source is read only', () => {
    expect(panel()).toContain('Read only: prefills the form')
    expect(panel()).toContain('data-read-only-source=""')
  })

  it('an unbound form offers to choose a source', () => {
    const plain = designerStateFrom({ fields: [], layout: null, theme: { source: 'workspace' } } as any)
    const html = renderToStaticMarkup(createElement(DataSourcePanel, { state: plain, source: undefined, loading: false, error: null, mapping: new Map(), selectedId: null, busy: false, onSelectField: () => {}, onAdd: () => {}, onChooseSource: () => {} }))
    expect(html).toContain('data-data-panel="none"')
    expect(html).toContain('Choose a data source')
  })

  it('an extension target (SharePoint): locked to its source, columns marked new', () => {
    const sp = designerStateFrom({ fields: [{ key: 'title', label: 'Title', type: 'text' }], layout: { rows: [{ columns: 1, cells: [{ field_key: 'title', span: 1 }] }], data_target: { extension: 'sharepoint', key: 'list', config: { list_id: TABLE } } }, theme: { source: 'workspace' } } as any)
    const target: FormSourceState = { ...source, kind: 'target', locked: true, writable: true, label: 'SharePoint list', description: { ...source.description!, title: 'SharePoint list "Requests"', mappings: [{ field: 'title', source: 'name' }] } }
    const html = renderToStaticMarkup(createElement(DataSourcePanel, { state: sp, source: target, loading: false, error: null, mapping: sourceMapping(sp, target), selectedId: null, busy: false, onSelectField: () => {}, onAdd: () => {}, onChooseSource: () => {} }))
    expect(html).toContain('Bound by its extension: loads and saves records')
    expect(html).not.toContain('aria-label="Change the data source"')
    expect(html).toContain('data-on-form="title"')
    const settings = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(DataBindingSettings, { state: sp, source: target, onChange: () => {} })))
    expect(settings).toContain('data-binding-settings="target"')
    expect(settings).toContain('SharePoint list &quot;Requests&quot;')
    expect(settings).toContain('Connected to SharePoint list')
    expect(settings).not.toContain('id="data-binding-kind"')
  })
})

describe('the Data tab: choosing the source', () => {
  it('None / a data table / an API reference, with what it loads and saves', () => {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(DataBindingSettings, { state, source, onChange: () => {} })))
    expect(html).toContain('data-binding-settings="table"')
    expect(html).toMatch(/<select id="data-binding-kind"[\s\S]*?<option value="none">None<\/option><option value="table" selected="">A data table<\/option><option value="reference">An API reference<\/option>/)
    expect(html).toContain('data-binding-save=""')
    expect(html).toContain('Read only: the table is not written.')
    expect(html).toContain('Add a “row_id” URL parameter')
  })
})

describe('a field\'s "Bound to"', () => {
  it('lists the source fields its type can hold, with clear; read only when the mapping is locked', () => {
    const html = renderToStaticMarkup(createElement(BoundToProperty, { field: state.fields[0], source, mapping: sourceMapping(state, source), busy: false, onBind: () => {} }))
    expect(html).toContain('data-bound-to="name"')
    expect(html).toMatch(/<option value="name" selected="">Name \(Text\)<\/option>/)
    expect(html).toContain('<option value="region">Region (Lookup)</option>')
    expect(html).not.toContain('value="credit"')
    expect(html).toContain('aria-label="Clear the binding"')
    expect(html).toContain('Loads from Customers (read only).')
    const locked: FormSourceState = { ...source, description: { ...source.description!, mappings: [{ field: 'customer', source: 'name', locked: true }] } }
    expect(renderToStaticMarkup(createElement(BoundToProperty, { field: state.fields[0], source: locked, mapping: sourceMapping(state, locked), busy: false, onBind: () => {} }))).toContain('managed by the connection')
  })
})

describe('the designer wiring', () => {
  it('the page frame has Outline and Data tabs beside the palette (keyboard: arrow keys switch)', () => {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FormDesigner, {
      chrome: 'page', title: 'Customer', formId: 'f1', initial: { fields: state.fields.map(({ _id: _i, _keyLocked: _k, ...f }) => f), layout: state.layout, theme: { source: 'workspace' } } as any,
      actions: [], savedThemes: [], canSaveTheme: false, onClose: () => {}, page: { backHref: '/automations/forms', backLabel: 'Back' },
    })))
    expect(html).toContain('role="tablist" aria-label="Outline and data"')
    expect(html).toContain('data-side-tab="outline"')
    expect(html).toContain('data-side-tab="data"')
  })

  it('the grid, a section\'s foot and a page chip take a dragged source field; nested grids do not', () => {
    const grid = read('components/forms/designer/grid-canvas.tsx')
    expect(grid).toContain('const sourceKey = e.dataTransfer.getData(DRAG_SOURCE_FIELD)')
    expect(grid).toContain('onDropSource(sourceKey, null, sectionKey)')
    expect(grid).toMatch(/t === DRAG_SOURCE_FIELD && Boolean\(onDropSource\)/)
    expect(read('components/forms/designer/page-strip.tsx')).toContain('onDropSource(sourceKey, pageId)')
    const designer = read('components/forms/designer/form-designer.tsx')
    // Drops go through dropData: a bound source's field (bindSource) or workflow data (wfd:…).
    expect(designer).toMatch(/onDropSource=\{acceptsDrops \? \(key, at, section\) => dropData\(key/)
    expect(designer).toMatch(/if \(source\?\.bind\) void bindSource\(\{ add: \[key\] \}, place\)/)
    // The Data tab holds the source chooser above parameters and variables.
    expect(designer).toContain('<DataBindingSettings state={state} source={source}')
  })
})
