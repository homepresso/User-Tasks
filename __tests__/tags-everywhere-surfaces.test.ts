/**
 * Source guards for tags on every object type:
 *
 *  - every object list renders a Tags column (tables) or tag chips (cards),
 *    offers "Tags…" per row and a tag filter; lists with row selection have
 *    bulk add / remove; every taggable type is editable from some list;
 *  - each object's editor carries the TagInput;
 *  - migration 20270122150000_tags_everywhere adds the column + GIN index to
 *    each new table, keeps RLS untouched, and re-creates the four tag
 *    functions with every type (packages only in the SECURITY DEFINER pair:
 *    authenticated has no grant on packages), keeping their security modes
 *    and grants;
 *  - docs list every object type and the migration has its docs row.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TAG_OBJECT_TYPE_KEYS, TAG_OBJECT_TYPE_LABELS } from '@/lib/tags/object-types'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/** Object lists: [file, kind, has row selection]. */
const LISTS: Array<[string, 'table' | 'cards' | 'both', boolean]> = [
  ['components/automations/workflow-list.tsx', 'both', true],
  ['components/forms/forms-library.tsx', 'table', false],
  ['components/data/data-table-list.tsx', 'table', true],
  ['components/reports/report-hub.tsx', 'both', true],
  ['components/business-rules/decision-table-list.tsx', 'both', true],
  ['components/email-templates/email-template-manager.tsx', 'table', false],
  ['components/extensibility/form-controls-view.tsx', 'cards', false],
  ['components/extensibility/workflow-activities-view.tsx', 'both', true],
  ['components/apps/apps-landing.tsx', 'cards', false],
  ['components/packages/packages-settings.tsx', 'cards', false],
  ['components/integrations/integrations-view.tsx', 'both', false],
  ['components/agents/agent-list.tsx', 'both', true],
  ['app/(dashboard)/automations/schedules/page.tsx', 'table', false],
]

describe('object lists show and edit tags', () => {
  it.each(LISTS)('%s has a Tags column / chips, "Tags…" and a tag filter', (file, kind, selectable) => {
    const src = read(file)
    if (kind !== 'cards') expect(src, 'Tags column header').toMatch(/data-tags-column|data-form-tags|>Tags<\/TH>/)
    if (kind !== 'table') expect(src, 'tag chips on cards').toMatch(/data-tags-cell|TagList|tagBadges/)
    expect(src, 'per-row Tags…').toMatch(/TagsActionButton|Tags…|onTags|InlineTagEditor|tagEditor/)
    expect(src, 'tag filter').toMatch(/TagFilterMenu|TagFilterBar|FilterMenu label="Tags"/)
    if (selectable) expect(src, 'bulk tags').toMatch(/BulkTagsDialog/)
  })

  it('every taggable type except tasks and references is editable from an object list', () => {
    const all = LISTS.map(([file]) => read(file)).join('\n')
    for (const type of TAG_OBJECT_TYPE_KEYS) {
      if (type === 'tasks' || type === 'references') continue
      expect(all, type).toMatch(new RegExp(`(ObjectTagsDialog|InlineTagEditor)[\\s\\S]{0,200}?type="${type}"|type="${type}"[\\s\\S]{0,80}?(ids|id)=|setIntegrationTags|setWorkflowTags|updateWorkflowTags|tagEditor`))
    }
  })

  it.each([
    ['components/business-rules/decision-table-editor.tsx'],
    ['components/apps/app-settings.tsx'],
    ['components/packages/package-editor.tsx'],
    ['app/(dashboard)/reports/builder/page.tsx'],
    ['components/data/create-table-dialog.tsx'],
    // The template editor (opened from the manager) edits the tags.
    ['components/email-templates/email-template-editor.tsx'],
  ])('%s edits tags with the TagInput', (file) => {
    expect(read(file)).toMatch(/<TagInput\b/)
  })
})

describe('migration 20270122150000_tags_everywhere', () => {
  const sql = read('supabase/migrations/20270122150000_tags_everywhere.sql')
  const fn = (name: string) => {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
    expect(start, name).toBeGreaterThan(-1)
    return sql.slice(start, sql.indexOf('$$;', sql.indexOf('AS $$', start)) + 3)
  }
  const TABLES: Record<string, string> = {
    data_tables: 'custom_tables', reports: 'reports', business_rules: 'decision_tables', email_templates: 'email_templates',
    form_controls: 'form_controls', apps: 'apps', packages: 'packages',
  }

  it('adds tags text[] NOT NULL DEFAULT {} and a GIN index to every new table', () => {
    for (const table of Object.values(TABLES)) {
      expect(sql).toContain(`ALTER TABLE public.${table}`)
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS tags text\\[\\] NOT NULL DEFAULT '\\{\\}'::text\\[\\];`))
      expect(sql).toMatch(new RegExp(`ON public\\.${table}\\s+USING gin \\(tags\\)`))
    }
  })

  it('leaves RLS and grants on the tables alone (plain PostgreSQL, additive)', () => {
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY|GRANT [A-Z, ]+ ON (TABLE )?public\.(custom_tables|reports|decision_tables|email_templates|form_controls|apps|packages)/)
    expect(sql).not.toMatch(/CONCURRENTLY|DROP TABLE|DROP COLUMN/)
  })

  it('the invoker functions cover every type but packages; the definer pair covers all', () => {
    const usage = fn('tag_usage')
    const objects = fn('tag_objects')
    for (const [type, table] of Object.entries(TABLES)) {
      if (type === 'packages') {
        expect(usage).not.toContain('public.packages')
        expect(objects).not.toContain('public.packages')
      } else {
        expect(usage).toContain(`'${type}'`); expect(usage).toContain(`public.${table}`)
        expect(objects).toContain(`'${type}'`); expect(objects).toContain(`public.${table}`)
      }
      expect(fn('remove_tag')).toContain(`UPDATE public.${table} SET tags`)
      expect(fn('remove_tag')).toContain(`'${type}'`)
      expect(fn('rename_tag')).toContain(`UPDATE public.${table} SET tags = public.tag_array_rename`)
      expect(fn('rename_tag')).toContain(`'${type}'`)
    }
    for (const old of ['tasks', 'workflows', 'forms', 'integrations', 'references', 'agents', 'activities']) {
      expect(usage).toContain(`'${old}'`)
      expect(fn('remove_tag')).toContain(`'${old}'`)
    }
    expect(usage).toMatch(/SECURITY INVOKER/)
    expect(objects).toMatch(/SECURITY INVOKER/)
    expect(fn('remove_tag')).toMatch(/SECURITY DEFINER/)
    expect(fn('rename_tag')).toMatch(/SECURITY DEFINER/)
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.rename_tag(uuid, text, text, uuid) TO service_role;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.remove_tag(uuid, text) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.tag_usage(uuid) TO authenticated, service_role;')
  })
})

describe('docs', () => {
  it('the tags docs list every object type; the migration has its row', () => {
    const governance = read('lib/docs/content/governance.ts')
    for (const type of TAG_OBJECT_TYPE_KEYS) expect(governance.toLowerCase(), type).toContain(TAG_OBJECT_TYPE_LABELS[type].toLowerCase())
    expect(read('docs/migrations.md')).toContain('20270122150000_tags_everywhere')
  })
})
