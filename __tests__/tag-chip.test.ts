/**
 * TagChip / TagList / TaskTags rendering: a chip carries its colour token
 * (chosen in the registry, else the automatic colour, or grey with auto
 * colour off), matches styles case-insensitively, truncates long names,
 * renders as a button with aria-pressed only when it filters, an
 * accessible remove button, "+N" overflow, and the colour picker's swatches.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/app/actions/tags', () => ({ setTagStyle: vi.fn() }))

import { TagChip, TagColorPicker, TagList } from '@/components/ui/tag-chip'
import { TaskTags } from '@/components/tasks/task-tags'
import { StaticTagStylesProvider } from '@/hooks/use-tag-styles'
import { autoTagColor, TAG_COLOR_TOKENS } from '@/lib/tags/palette'
import type { TagStyles } from '@/lib/services/tags'

const STYLES: TagStyles = {
  styles: [{ name: 'Finance', key: 'finance', color: 'green', description: 'Money matters', updated_at: null }],
  settings: { auto_color: true, allow_new: true },
}

function render(node: React.ReactElement, styles: TagStyles | null = STYLES) {
  return renderToStaticMarkup(h(StaticTagStylesProvider, { styles, children: node }))
}

describe('TagChip', () => {
  it('uses the colour chosen in the registry, matched case-insensitively', () => {
    const html = render(h(TagChip, { name: 'FINANCE' }))
    expect(html).toContain('data-tag-color="green"')
    expect(html).toContain('data-tag="FINANCE"')
    expect(html).toMatch(/class="tag-chip /)
  })

  it('gives an unstyled tag its automatic colour, and grey when auto colour is off', () => {
    expect(render(h(TagChip, { name: 'urgent' }))).toContain(`data-tag-color="${autoTagColor('urgent')}"`)
    expect(render(h(TagChip, { name: 'urgent' }), { styles: [], settings: { auto_color: false, allow_new: true } })).toContain('data-tag-color="gray"')
    // No provider (public pages): automatic colour.
    expect(renderToStaticMarkup(h(TagChip, { name: 'urgent' }))).toContain(`data-tag-color="${autoTagColor('urgent')}"`)
  })

  it('a colour prop overrides (previews) and the name is tidied and truncated', () => {
    const html = render(h(TagChip, { name: '  Finance   team ', color: 'rose', maxWidthClass: 'max-w-[5rem]' }))
    expect(html).toContain('data-tag-color="rose"')
    expect(html).toContain('>Finance team</span>')
    expect(html).toContain('max-w-[5rem]')
    expect(html).toContain('class="truncate"')
  })

  it('is a plain span unless it filters; a filter chip is a button with aria-pressed', () => {
    expect(render(h(TagChip, { name: 'ops' }))).not.toContain('<button')
    const html = render(h(TagChip, { name: 'ops', onClick: () => {}, selected: true }))
    expect(html).toMatch(/<button type="button" aria-pressed="true"/)
    expect(html).toContain('data-tag-selected="true"')
  })

  it('has an accessible remove button', () => {
    expect(render(h(TagChip, { name: 'ops', onRemove: () => {} }))).toContain('aria-label="Remove tag ops"')
  })

  it('size variants', () => {
    expect(render(h(TagChip, { name: 'a', size: 'xs' }))).toContain('h-4')
    expect(render(h(TagChip, { name: 'a', size: 'md' }))).toContain('h-6')
  })
})

describe('TagList / TaskTags', () => {
  it('shows up to max chips (deduplicated) and "+N" for the rest', () => {
    const html = render(h(TagList, { tags: ['a', 'b', 'b', 'c', 'd', ' '], max: 2 }))
    expect(html.match(/class="tag-chip /g)).toHaveLength(2)
    expect(html).toContain('+2')
  })

  it('renders nothing without tags', () => {
    expect(render(h(TagList, { tags: [] }))).toBe('')
    expect(render(h(TaskTags, { tags: null }))).toBe('')
  })

  it('TaskTags: xs chips, two by default', () => {
    const html = render(h(TaskTags, { tags: ['finance', 'urgent', 'q3'] }))
    expect(html.match(/class="tag-chip /g)).toHaveLength(2)
    expect(html).toContain('data-tag-color="green"')
    expect(html).toContain('+1')
  })
})

describe('TagColorPicker', () => {
  it('offers Auto plus every palette token as radios, the current one checked', () => {
    const html = render(h(TagColorPicker, { name: 'finance', value: 'green', onChange: () => {} }))
    expect(html).toContain('data-tag-swatch="auto"')
    for (const token of TAG_COLOR_TOKENS) expect(html).toContain(`data-tag-swatch="${token}"`)
    expect(html).toMatch(/aria-checked="true" aria-label="Green"/)
    expect(html).toContain('role="radiogroup"')
  })
})

describe('tag helpers', () => {
  it('parseTagText: comma text to tidied tags, no case duplicates', async () => {
    const { parseTagText } = await import('@/components/ui/tag-input')
    expect(parseTagText(' finance,  Q3  review ,FINANCE,, ')).toEqual(['finance', 'Q3 review'])
  })

  it('Settings → Tags sorts by name, usage per type or total', async () => {
    const { sortTags } = await import('@/components/settings/tags-settings')
    const t = (key: string, total: number, tasks = 0) => ({ name: key, key, color: 'gray', chosen_color: null, description: null, styled: false, usage: { tasks }, total }) as never
    const list = [t('b', 5, 1), t('a', 9, 0), t('c', 1, 7)]
    expect(sortTags(list, { key: 'name', dir: 'asc' }).map((x: { key: string }) => x.key)).toEqual(['a', 'b', 'c'])
    expect(sortTags(list, { key: 'total', dir: 'desc' }).map((x: { key: string }) => x.key)).toEqual(['a', 'b', 'c'])
    expect(sortTags(list, { key: 'tasks', dir: 'desc' }).map((x: { key: string }) => x.key)).toEqual(['c', 'b', 'a'])
  })
})
