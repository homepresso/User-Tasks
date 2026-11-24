/**
 * 20270127090000_tenant_delete_fk_actions.sql: deleting a workspace must not
 * stop on its own rows. Every tenant_id key cascades (the baseline left nine
 * with NO ACTION), users.current_tenant_id is SET NULL, and nothing else is
 * touched (no data, no policies, no row-to-row keys). Verified against a
 * scratch database built from the whole chain: before it, DELETE FROM tenants
 * failed on agent_queue_tenant_id_fkey; after it the workspace and all its
 * rows go, another workspace's member keeps their account with
 * current_tenant_id NULL, and members still can't delete a tenant (no delete
 * policy: 0 rows).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NON_CASCADING } from '@/lib/gallery/verify-core'

const FILE = '20270127090000_tenant_delete_fk_actions.sql'
const sql = readFileSync(`supabase/migrations/${FILE}`, 'utf8')
const baseline = readFileSync('supabase/migrations/20261015000000_baseline.sql', 'utf8')
const code = sql.replace(/--.*$/gm, '')

const CASCADE = ['agent_queue', 'agent_runs', 'agents', 'task_assignees', 'task_escalations', 'task_reminders', 'task_responses', 'workflow_logs', 'workflow_versions']

describe('tenant delete foreign key actions', () => {
  it('sorts after the AI cost breakdown migration and is listed in docs/migrations.md', () => {
    const all = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf('20270126130000_ai_cost_breakdown.sql'))
    expect(readFileSync('docs/migrations.md', 'utf8')).toContain(`\`${FILE}\``)
  })

  it('cascades the workspace-owned rows and sets users.current_tenant_id to NULL', () => {
    for (const t of CASCADE) expect(code).toMatch(new RegExp(`\\('${t}',\\s*'tenant_id',\\s*'CASCADE'\\)`))
    expect(code).toMatch(/\('users',\s*'current_tenant_id',\s*'SET NULL'\)/)
    // users.tenant_id and gallery_submissions are not touched.
    expect(code).not.toMatch(/\('users',\s*'tenant_id'/)
    expect(code).not.toMatch(/gallery_submissions/)
  })

  it('covers every baseline tenant key that had no ON DELETE action', () => {
    const noAction = [...baseline.matchAll(/ALTER TABLE ONLY "public"\."(\w+)"\s+ADD CONSTRAINT "\w+" FOREIGN KEY \("(\w+)"\) REFERENCES "public"\."tenants"\("id"\);/g)].map((m) => `${m[1]}.${m[2]}`)
    // Later migrations already cascade these two.
    const fixedLater = ['form_submissions.tenant_id', 'form_template_versions.tenant_id']
    expect(noAction.filter((k) => !fixedLater.includes(k)).sort()).toEqual([...CASCADE.map((t) => `${t}.tenant_id`), 'users.current_tenant_id'].sort())
  })

  it('changes keys only: no data, no policies, idempotent and validated', () => {
    expect(code).not.toMatch(/\b(delete\s+from|update\s+public\.|truncate|drop\s+table|drop\s+column|policy)\b/i)
    expect(code).toMatch(/NOT VALID/)
    expect(code).toMatch(/VALIDATE CONSTRAINT/)
    expect(code).toMatch(/to_regclass/)
  })

  it('the scratch-workspace cleanup still empties those tables first (works before the migration is applied)', () => {
    for (const t of ['task_responses', 'task_escalations', 'task_reminders', 'task_assignees', 'agent_queue', 'agent_runs', 'agents', 'workflow_logs', 'workflow_versions']) expect(NON_CASCADING).toContain(t)
  })
})
