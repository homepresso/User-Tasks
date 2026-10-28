import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, csvFilter, looseObject } from './common'

const SECTIONS = 'workflows, decision_tables, workflow_activities, data_tables, integrations (with their references and objects), agents, reports, retention_policies, roles, mcp_servers, email_templates, connectors (non-secret config only), log_destinations (no credentials or shipper state), form_themes, forms (fields, layout and theme; versions stay per workspace), workspace_theme (one workspace-theme.json; uploaded fonts by file name, logos by URL — images from another workspace are dropped on apply)'

const repoFile = z.object({
  path: z.string().min(1).max(512).describe('Path relative to the config folder, e.g. workflows/invoice-approval-3fa8c21b.json'),
  content: z.string().describe('File content (JSON asset envelope, or manifest.json)'),
})

const skippedSection = z.object({ section: z.string(), permission: z.string(), reason: z.string() })

export const configExportQuery = z.object({
  types: csvFilter(`Sections to export (default all): ${SECTIONS}`),
  ids: csvFilter('Only these asset ids (an integration brings its references and objects)'),
  format: z.enum(['files', 'manifest']).optional().describe('files (default): GitHub-sync layout; manifest: one JSON manifest'),
  include_rows: booleanFlag('true: also export the rows of every exported data table (table_rows section, data-rows/ folder; needs data.view; at most 10,000 rows per table)'),
  with_dependencies: booleanFlag('true: expand `ids` with everything they depend on (sub-workflows, activities, decision tables, data tables, integrations/connectors, email templates, agents, custom roles, retention policies, MCP servers)'),
})

export const configExportResponse = z.looseObject({
  format_version: z.number().int(),
  files: z.array(repoFile).optional().describe('format=files: one envelope per asset plus manifest.json'),
  manifest: looseObject.optional().describe('format=manifest'),
  skipped: z.array(skippedSection).describe('Sections left out because the caller lacks their view permission'),
})

export const configApplyBody = z.object({
  files: z.array(repoFile).max(5000).optional().describe('Files as produced by GET /config/export (YAML must be converted to JSON first)'),
  manifest: looseObject.optional().describe('Alternatively, a whole manifest (format=manifest export)'),
  dry_run: z.boolean().optional().describe('Plan only; nothing is written (needs view permissions only)'),
  adopt_by_name: z.boolean().optional().describe('Match unmapped assets to existing ones with the same unique name'),
  source_label: z.string().regex(/^[A-Za-z0-9._\/:-]{1,100}$/).optional().describe('Recorded with id mappings as cli:<label> (default "default")'),
  rows_mode: z.enum(['merge', 'replace', 'skip']).optional().describe('table_rows: merge (default; update rows applied before, insert the rest), replace (delete the table\'s rows first) or skip. Needs data.manage_rows'),
})

const fieldDiff = z.looseObject({ path: z.string(), before: z.any().optional(), after: z.any().optional() })
const assetPlan = z.looseObject({
  section: z.string(),
  asset_type: z.string(),
  source_id: z.string().nullable(),
  local_id: z.string().nullable(),
  name: z.string(),
  action: z.enum(['create', 'update', 'unchanged', 'error']),
  matched_by: z.enum(['id', 'mapping', 'name', 'slug', 'package']).optional(),
  diffs: z.array(fieldDiff).optional(),
  error: z.string().optional(),
  file: z.string().optional(),
})

export const configApplyResponse = z.looseObject({
  dry_run: z.boolean(),
  plan: z.looseObject({
    assets: z.array(assetPlan),
    summary: z.object({ create: z.number().int(), update: z.number().int(), unchanged: z.number().int(), error: z.number().int() }),
  }),
  missing_permissions: z.array(z.object({ section: z.string(), permission: z.string() })).optional()
    .describe('Dry runs: permissions a real apply would additionally need'),
  warnings: z.array(looseObject),
  result: z.looseObject({
    created: z.record(z.string(), z.number()),
    updated: z.record(z.string(), z.number()),
    errors: z.array(z.looseObject({ asset_type: z.string(), source_id: z.string(), error: z.string() })),
    warnings: z.array(looseObject),
  }).optional().describe('Real applies only'),
})

const tags = ['Config']

export const exportConfigEndpoint = defineEndpoint({
  method: 'GET', path: '/config/export', operationId: 'exportConfig', tags,
  summary: 'Export workspace configuration as config-as-code files',
  description: 'Same layout as a GitHub-sync repository. Each section needs its own view permission; sections the caller cannot view are listed in `skipped`. Secrets are always replaced with "__SECRET__".',
  permission: null,
  query: configExportQuery, response: configExportResponse,
  async: true,
})

export const applyConfigEndpoint = defineEndpoint({
  method: 'POST', path: '/config/apply', operationId: 'applyConfig', tags,
  summary: 'Apply config-as-code files (create or update; never deletes)',
  description: 'Returns a per-asset plan (create / update / unchanged / error) with field diffs. Identity: same id in this workspace → id mapping from an earlier apply or deploy → (adopt_by_name) unique name → create. "__SECRET__" keeps the stored secret. Needs view permission on every section present plus create/edit for the sections that change; limits 5 MB and 2000 assets.',
  permission: null,
  body: configApplyBody, response: configApplyResponse,
  async: true,
})

export const configEndpoints = [exportConfigEndpoint, applyConfigEndpoint]
