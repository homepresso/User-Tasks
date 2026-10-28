// Manifest import: recreate manifest assets inside a tenant.

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests and untyped table rows are free-form JSON */

import { encryptSensitiveFields } from '@/lib/secret-fields'
import type { ServiceContext } from '@/lib/services/context'
import { applyConnectorManifest } from '@/lib/services/connectors'
import { applyEmailTemplateManifest } from '@/lib/services/email-templates'
import { applyLogDestinationManifest } from '@/lib/services/log-destinations'
import { applyFormManifest, applyFormThemeManifest } from '@/lib/services/forms'
import { serviceRoleClient } from '@/lib/services/_shared'
import { isRetiredFormAsset, restoreFormHeaderImage, stripWorkflowFormPins } from './forms'
import {
  createEmptyAssetIdMaps,
  remapKnownIds,
  type AssetIdMaps,
} from './id-maps'
import { resolveSecretPlaceholders } from './scrub'
import {
  cloneJson,
  isObjectBackedReference,
  normalizeScaffoldDecisionTable,
  normalizeScaffoldReportConfig,
  normalizeScaffoldWorkflow,
} from './normalize'

export type ImportManifestParams = {
  supabase: any
  tenantId: string
  actingUserId?: string | null
  manifest: Record<string, any>
  /**
   * Import strategy. 'create' (default) inserts everything and rolls back on
   * failure. 'upsert' updates rows already mapped by idMapSeed (when the
   * local row still exists), inserts the rest, records per-asset errors in
   * the result instead of rolling back, and reports update counts.
   */
  mode?: 'create' | 'upsert'
  /** Seed id maps so pre-resolved assets remap without being recreated. */
  idMapSeed?: AssetIdMaps
  /** Invoked after each successful asset insert. */
  onAssetWritten?: (assetType: string, sourceId: string, localId: string) => void
  /**
   * Context for the sections written through their services (email
   * templates, connectors). Config apply passes the caller's (permission-
   * gated) context; without one an ungated context for the tenant is used.
   */
  serviceContext?: ServiceContext
}

/**
 * Workflows in import order: every workflow after the workflows it calls
 * (call_sub_workflow → sub_workflow_id), otherwise manifest order. Pure.
 */
export function orderWorkflowsByDependencies<T extends { id?: unknown; nodes?: unknown }>(workflows: T[]): T[] {
  const byId = new Map(workflows.map((wf) => [String(wf?.id), wf]))
  const ordered: T[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (wf: T) => {
    const id = String(wf?.id)
    if (state.get(id)) return
    state.set(id, 'visiting')
    for (const node of Array.isArray(wf?.nodes) ? (wf.nodes as any[]) : []) {
      const child = node?.type === 'call_sub_workflow' ? byId.get(String(node?.config?.sub_workflow_id ?? '')) : undefined
      if (child && child !== wf) visit(child)
    }
    state.set(id, 'done')
    ordered.push(wf)
  }
  for (const wf of workflows) visit(wf)
  return ordered
}

export async function importManifest(params: ImportManifestParams) {
  const {
    supabase,
    tenantId,
    actingUserId,
    manifest,
    idMapSeed,
    onAssetWritten,
  } = params
  const mode = params.mode ?? 'create'
  const serviceContext: ServiceContext = params.serviceContext ?? {
    supabase, tenantId, actorId: actingUserId ?? null, permissions: null, authKind: 'session', source: 'api',
  }

  // Seed the internal id maps BEFORE any section is processed so that in
  // upsert mode remapKnownIds resolves cross-references to EXISTING local
  // assets even when the referencing asset is imported before (or without)
  // its dependency being touched in this run.
  const idMaps = idMapSeed ?? createEmptyAssetIdMaps()
  const created: Record<string, any[]> = {
    data_tables: [] as any[],
    objects: [] as any[],
    integrations: [] as any[],
    references: [] as any[],
    decision_tables: [] as any[],
    retention_policies: [] as any[],
    agents: [] as any[],
    workflows: [] as any[],
    reports: [] as any[],
    workflow_activities: [] as any[],
  }
  // v3-only sections are tracked (and reported in counts) only when the
  // manifest actually carries them, so v2 import results stay identical.
  if (Array.isArray(manifest.roles)) created.roles = []
  if (Array.isArray(manifest.mcp_servers)) created.mcp_servers = []
  if (Array.isArray(manifest.email_templates)) created.email_templates = []
  if (Array.isArray(manifest.connectors)) created.connectors = []
  if (Array.isArray(manifest.log_destinations)) created.log_destinations = []
  if (Array.isArray(manifest.form_themes)) created.form_themes = []
  // A `forms` section in the retired shape (no field list) is skipped below.
  const retiredForms = (Array.isArray(manifest.forms) ? manifest.forms : []).filter(isRetiredFormAsset)
  const portableForms = (Array.isArray(manifest.forms) ? manifest.forms : []).filter((form: unknown) => !isRetiredFormAsset(form))
  if (Array.isArray(manifest.forms) && (portableForms.length > 0 || retiredForms.length === 0)) created.forms = []

  const updatedCounts: Record<string, number> = {}
  const upsertErrors: Array<{ asset_type: string; source_id: string; error: string }> = []
  // Non-fatal, per-asset notes (skipped retired sections). Reported in BOTH
  // modes, but only included in the result when non-empty so existing
  // callers see identical shapes.
  const importWarnings: Array<{ asset_type: string; source_id: string; warning: string }> = []

  // In upsert mode a failing asset write is recorded and skipped instead of
  // aborting the run: rows that were already updated cannot be rolled back.
  // In create mode this is a passthrough and errors propagate to the
  // all-or-nothing rollback below, exactly as before.
  const guardAsset = async (assetType: string, sourceId: unknown, fn: () => Promise<void>) => {
    if (mode !== 'upsert') return fn()
    try {
      await fn()
    } catch (error: any) {
      upsertErrors.push({
        asset_type: assetType,
        source_id: String(sourceId ?? ''),
        error: String(error?.message ?? error),
      })
    }
  }

  // Upsert lookup: a seeded source→local mapping only counts when the local
  // row still exists. When it does not (deleted locally), the asset falls
  // through to the insert path and the caller learns the replacement id
  // through onAssetWritten.
  const findExistingForUpsert = async (table: string, mapName: keyof AssetIdMaps, sourceId: unknown): Promise<any | null> => {
    if (mode !== 'upsert') return null
    const localId = typeof sourceId === 'string' && sourceId ? idMaps[mapName][sourceId] : undefined
    if (!localId) return null
    const { data } = await (supabase as any)
      .from(table)
      .select('*')
      .eq('id', localId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return data ?? null
  }

  // Insert (the unchanged create path) or, when an existing row was found,
  // UPDATE it with the same column payload the create path inserts. On
  // update, '__SECRET__' placeholders resolve to the existing row's value at
  // the same path; on upsert-mode inserts they are dropped, matching
  // create-mode tenant imports.
  const writeAssetRow = async (args: {
    table: string
    mapName: keyof AssetIdMaps
    sourceId: unknown
    existing: any | null
    payload: Record<string, any>
    failureMessage: string
  }): Promise<any> => {
    if (args.existing) {
      const payload = resolveSecretPlaceholders(args.payload, args.existing)
      const { data, error } = await (supabase as any)
        .from(args.table)
        .update(payload)
        .eq('id', args.existing.id)
        .eq('tenant_id', tenantId)
        .select('*')
        .single()
      if (error || !data) throw new Error(error?.message ?? args.failureMessage)
      updatedCounts[args.mapName] = (updatedCounts[args.mapName] ?? 0) + 1
      return data
    }
    const payload = mode === 'upsert' ? resolveSecretPlaceholders(args.payload) : args.payload
    const { data, error } = await (supabase as any).from(args.table).insert(payload).select('*').single()
    if (error || !data) throw new Error(error?.message ?? args.failureMessage)
    return data
  }

  async function rollbackCreatedAssets() {
    const deleteByIds = async (table: string, ids: string[]) => {
      if (ids.length === 0) return
      await (supabase as any).from(table).delete().in('id', ids)
    }

    // Connectors take their generated references and integration with them.
    const connectorIntegrations = (created.connectors ?? []).map((item: any) => item.integration_id).filter(Boolean)
    if (connectorIntegrations.length) await (supabase as any).from('integration_references').delete().in('integration_id', connectorIntegrations)
    await deleteByIds('tenant_connectors', (created.connectors ?? []).map((item: any) => item.id))
    await deleteByIds('integrations', connectorIntegrations)
    await deleteByIds('email_templates', (created.email_templates ?? []).map((item: any) => item.id))
    await deleteByIds('log_destinations', (created.log_destinations ?? []).map((item: any) => item.id))
    // Forms and form themes have no client write grants: roll back with the
    // service role, pinned to the tenant (versions cascade with their form).
    const createdForms = (created.forms ?? []).map((item: any) => item.id)
    const createdThemes = (created.form_themes ?? []).map((item: any) => item.id)
    if (createdForms.length || createdThemes.length) {
      const admin = await serviceRoleClient(serviceContext).catch(() => supabase)
      if (createdForms.length) await (admin as any).from('forms').delete().eq('tenant_id', tenantId).in('id', createdForms)
      if (createdThemes.length) await (admin as any).from('form_themes').delete().eq('tenant_id', tenantId).in('id', createdThemes)
    }

    await deleteByIds('reports', created.reports.map((item: any) => item.id))
    await deleteByIds('workflows', created.workflows.map((item: any) => item.id))
    await deleteByIds('agents', created.agents.map((item: any) => item.id))
    await deleteByIds('integration_object_sources', created.objects.flatMap((item: any) => item.source_ids ?? []))
    await deleteByIds('integration_objects', created.objects.map((item: any) => item.id))
    await deleteByIds('custom_workflow_activities', created.workflow_activities.map((item: any) => item.id))
    await deleteByIds('mcp_servers', (created.mcp_servers ?? []).map((item: any) => item.id))
    // Roles reference retention policies, so they roll back first.
    await deleteByIds('roles', (created.roles ?? []).map((item: any) => item.id))
    await deleteByIds('retention_policies', created.retention_policies.map((item: any) => item.id))
    await deleteByIds('decision_tables', created.decision_tables.map((item: any) => item.id))
    await deleteByIds('integration_references', created.references.map((item: any) => item.id))
    await deleteByIds('integrations', created.integrations.map((item: any) => item.id))
    await deleteByIds('custom_tables', created.data_tables.map((item: any) => item.id))
  }

  try {
    // Email templates and connectors depend on nothing else; they go first so
    // workflows/agents that use them remap (email_template_id, a connector's
    // generated integration_id / reference_id).
    let defaultClaimed = false
    for (const template of manifest.email_templates ?? []) {
      await guardAsset('email_template', template?.id, async () => {
        let existing = await findExistingForUpsert('email_templates', 'email_template', template.id)
        // Upsert also matches a unique same-name template (every tenant is
        // seeded with "UserTasks Default"), so promotion doesn't duplicate it.
        if (!existing && mode === 'upsert' && template.name) {
          const { data: byName } = await (supabase as any).from('email_templates')
            .select('id').eq('tenant_id', tenantId).eq('name', String(template.name).trim())
          const taken = new Set(Object.values(idMaps.email_template))
          const candidates = ((byName ?? []) as any[]).filter((row) => !taken.has(String(row.id)))
          if (candidates.length === 1 && (byName ?? []).length === 1) existing = candidates[0]
        }
        // At most one default: the first template flagged is_default wins.
        const allowDefault = template.is_default === true && !defaultClaimed
        if (template.is_default === true && defaultClaimed) {
          importWarnings.push({ asset_type: 'email_template', source_id: String(template.id ?? ''), warning: `"${template.name}" was not made the default: another template in the manifest already is` })
        }
        if (allowDefault) defaultClaimed = true
        const data = await applyEmailTemplateManifest(serviceContext, template, existing?.id ?? null, { allowDefault })
        idMaps.email_template[template.id] = data.id
        if (existing) {
          updatedCounts.email_template = (updatedCounts.email_template ?? 0) + 1
        } else {
          onAssetWritten?.('email_template', template.id, data.id)
          created.email_templates.push(data)
        }
      })
    }

    for (const connector of manifest.connectors ?? []) {
      await guardAsset('connector', connector?.id, async () => {
        const existing = await findExistingForUpsert('tenant_connectors', 'connector', connector.id)
        const result = await applyConnectorManifest(serviceContext, connector, existing?.id ?? null)
        idMaps.connector[connector.id] = result.id
        Object.assign(idMaps.integration, result.idMap.integration)
        Object.assign(idMaps.reference, result.idMap.reference)
        for (const warning of result.warnings) importWarnings.push({ asset_type: 'connector', source_id: String(connector.id ?? ''), warning })
        if (result.created) {
          onAssetWritten?.('connector', connector.id, result.id)
          for (const [sourceId, localId] of Object.entries(result.idMap.integration)) onAssetWritten?.('integration', sourceId, localId)
          for (const [sourceId, localId] of Object.entries(result.idMap.reference)) onAssetWritten?.('reference', sourceId, localId)
          const integrationId = Object.values(result.idMap.integration)[0] ?? null
          created.connectors.push({ id: result.id, integration_id: integrationId })
        } else {
          updatedCounts.connector = (updatedCounts.connector ?? 0) + 1
        }
      })
    }

    for (const table of manifest.data_tables ?? []) {
      await guardAsset('data_table', table?.id, async () => {
        const columns = remapKnownIds(cloneJson(table.columns ?? []), idMaps)
        const existing = await findExistingForUpsert('custom_tables', 'data_table', table.id)
        // Slugs are unique per workspace: a new table whose name another table
        // already uses (two packages with a "Cost centres" table) gets -2, -3…
        let slug = table.slug ?? String(table.name ?? 'table').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        if (!existing) {
          const { data: taken } = await (supabase as any).from('custom_tables').select('slug').eq('tenant_id', tenantId).like('slug', `${slug.replace(/[%_]/g, '')}%`)
          const used = new Set(((taken ?? []) as any[]).map((row) => String(row.slug)))
          if (used.has(slug)) {
            let n = 2
            while (used.has(`${slug}-${n}`)) n++
            slug = `${slug}-${n}`
          }
        }
        const data = await writeAssetRow({
          table: 'custom_tables',
          mapName: 'data_table',
          sourceId: table.id,
          existing,
          failureMessage: 'Failed to import data table',
          payload: {
            tenant_id: tenantId,
            name: table.name,
            ...(existing ? {} : { slug }),
            description: table.description ?? null,
            columns,
            created_by: actingUserId ?? null,
          },
        })
        if (!existing) {
          idMaps.data_table[table.id] = data.id
          onAssetWritten?.('data_table', table.id, data.id)
          created.data_tables.push(data)
        }
      })
    }

    const referencesByIntegrationId = new Map<string, any[]>()
    for (const reference of manifest.references ?? []) {
      const list = referencesByIntegrationId.get(reference.integration_id) ?? []
      list.push(reference)
      referencesByIntegrationId.set(reference.integration_id, list)
    }

    const objectBackedReferenceIds = new Set(
      (Array.isArray(manifest.objects) ? manifest.objects : [])
        .map((item: any) => String(item?.generated_reference_id ?? '').trim())
        .filter(Boolean),
    )

    for (const integration of manifest.integrations ?? []) {
      await guardAsset('integration', integration?.id, async () => {
        if (integration?.name === '__objects__' && Array.isArray(manifest.objects) && manifest.objects.length > 0) {
          return
        }
        const existing = await findExistingForUpsert('integrations', 'integration', integration.id)
        // Encrypt any credential fields a manifest may carry (exports are sanitized,
        // but user-authored manifests can include plaintext secrets). In upsert
        // mode '__SECRET__' placeholders must resolve against the existing
        // row's (already encrypted) config BEFORE encryption runs, otherwise
        // the placeholder string itself would get encrypted.
        const sanitizedConfig = encryptSensitiveFields(
          mode === 'upsert'
            ? resolveSecretPlaceholders(cloneJson(integration.config ?? {}), existing?.config)
            : cloneJson(integration.config ?? {}),
        )
        const data = await writeAssetRow({
          table: 'integrations',
          mapName: 'integration',
          sourceId: integration.id,
          existing,
          failureMessage: 'Failed to import integration',
          payload: {
            tenant_id: tenantId,
            name: integration.name,
            type: integration.type,
            config: sanitizedConfig,
            is_active: integration.is_active ?? true,
            tags: integration.tags ?? null,
          },
        })
        if (!existing) {
          idMaps.integration[integration.id] = data.id
          onAssetWritten?.('integration', integration.id, data.id)
          created.integrations.push(data)
        }

        for (const reference of referencesByIntegrationId.get(integration.id) ?? []) {
          if (objectBackedReferenceIds.has(String(reference?.id ?? '').trim()) || isObjectBackedReference(reference)) {
            continue
          }
          await guardAsset('reference', reference?.id, async () => {
            const existingReference = await findExistingForUpsert('integration_references', 'reference', reference.id)
            const requestConfig = remapKnownIds(cloneJson(reference.request_config ?? {}), idMaps)
            const inputs = remapKnownIds(cloneJson(reference.inputs ?? []), idMaps)
            const outputs = remapKnownIds(cloneJson(reference.outputs ?? []), idMaps)
            const refData = await writeAssetRow({
              table: 'integration_references',
              mapName: 'reference',
              sourceId: reference.id,
              existing: existingReference,
              failureMessage: 'Failed to import integration reference',
              payload: {
                tenant_id: tenantId,
                integration_id: data.id,
                name: reference.name,
                description: reference.description ?? null,
                tags: reference.tags ?? null,
                request_config: requestConfig,
                inputs,
                outputs,
              },
            })
            if (existingReference) return
            idMaps.reference[reference.id] = refData.id
            onAssetWritten?.('reference', reference.id, refData.id)
            created.references.push(refData)
          })
        }
      })
    }

    for (const objectDef of manifest.objects ?? []) {
      await guardAsset('object', objectDef?.id, async () => {
        const buildRemappedSources = (objectId: string) => (Array.isArray(objectDef.sources) ? objectDef.sources : []).map((source: any, index: number) => ({
          object_id: objectId,
          source_type: source.source_type ?? source.sourceType,
          table_id: source.table_id ? (idMaps.data_table[source.table_id] ?? source.table_id) : (source.tableId ? (idMaps.data_table[source.tableId] ?? source.tableId) : null),
          reference_id: source.reference_id ? (idMaps.reference[source.reference_id] ?? source.reference_id) : (source.referenceId ? (idMaps.reference[source.referenceId] ?? source.referenceId) : null),
          alias: source.alias,
          is_primary: Boolean(source.is_primary ?? source.isPrimary),
          join_type: source.join_type ?? source.joinType ?? null,
          join_on_local: source.join_on_local ?? source.joinOnLocal ?? null,
          join_on_foreign: source.join_on_foreign ?? source.joinOnForeign ?? null,
          join_to_alias: source.join_to_alias ?? source.joinToAlias ?? null,
          sort_order: source.sort_order ?? index,
        }))

        const computeObjectOutputs = async (remappedSources: any[]) => {
          const primarySource = remappedSources.find((source: any) => source.is_primary)
          const primaryTable = primarySource?.table_id
            ? (await (supabase as any).from('custom_tables').select('columns').eq('id', primarySource.table_id).eq('tenant_id', tenantId).maybeSingle()).data
            : null
          return Array.isArray((primaryTable as any)?.columns)
            ? ((primaryTable as any).columns as any[]).map((column: any) => ({
                id: crypto.randomUUID(),
                name: column.name ?? column.key,
                path: `${primarySource.alias}.${column.key}`,
                type: column.type ?? 'string',
              }))
            : []
        }

        // Composite objects have no direct id-map entry: they resolve through
        // their generated reference. When that reference is already mapped to
        // a live local reference, upsert UPDATES the object in place — object
        // row fields, a delete-and-reinsert of its sources, and a refresh of
        // the generated reference — instead of skipping it.
        if (mode === 'upsert' && objectDef?.generated_reference_id) {
          const existingGenerated = await findExistingForUpsert('integration_references', 'reference', objectDef.generated_reference_id)
          const localObjectId = String(existingGenerated?.request_config?.object_id ?? '').trim()
          const { data: existingObject } = localObjectId
            ? await (supabase as any).from('integration_objects').select('id').eq('id', localObjectId).eq('tenant_id', tenantId).maybeSingle()
            : { data: null }
          if (existingGenerated && existingObject) {
            const { error: objectUpdateError } = await (supabase as any).from('integration_objects').update({
              name: objectDef.name,
              description: objectDef.description ?? null,
              config: cloneJson(objectDef.config ?? {}),
            }).eq('id', existingObject.id).eq('tenant_id', tenantId)
            if (objectUpdateError) throw new Error(objectUpdateError.message)

            const { error: deleteSourcesError } = await (supabase as any).from('integration_object_sources')
              .delete()
              .eq('object_id', existingObject.id)
            if (deleteSourcesError) throw new Error(deleteSourcesError.message)

            const remappedSources = buildRemappedSources(existingObject.id)
            const { error: sourceError } = await (supabase as any).from('integration_object_sources').insert(remappedSources)
            if (sourceError) throw new Error(sourceError.message)

            // Refresh the generated reference the same way the create path
            // builds it, KEEPING its id (and its integration) so everything
            // pointing at it keeps resolving.
            const outputs = await computeObjectOutputs(remappedSources)
            const { error: referenceUpdateError } = await (supabase as any).from('integration_references').update({
              name: objectDef.generated_reference_name ?? `Object: ${objectDef.name}`,
              description: objectDef.description ?? `Composite object ${objectDef.name}`,
              request_config: { _executor: 'object', method: 'GET', operation: 'list', object_id: existingObject.id },
              inputs: [],
              outputs,
            }).eq('id', existingGenerated.id).eq('tenant_id', tenantId)
            if (referenceUpdateError) throw new Error(referenceUpdateError.message)

            idMaps.reference[objectDef.generated_reference_id] = existingGenerated.id
            updatedCounts.object = (updatedCounts.object ?? 0) + 1
            return
          }
          // A mapped-but-dead reference (or a reference whose object row is
          // gone) falls through to the create path and is rebuilt fresh.
        }

        const { data: objectRow, error: objectError } = await (supabase as any).from('integration_objects').insert({
          tenant_id: tenantId,
          name: objectDef.name,
          description: objectDef.description ?? null,
          config: cloneJson(objectDef.config ?? {}),
        }).select('*').single()
        if (objectError || !objectRow) throw new Error(objectError?.message ?? 'Failed to import composite object')

        const remappedSources = buildRemappedSources(objectRow.id)

        const { data: sourceRows, error: sourceError } = await (supabase as any).from('integration_object_sources').insert(remappedSources).select('*')
        if (sourceError) throw new Error(sourceError.message)

        const outputs = await computeObjectOutputs(remappedSources)

        const { data: objectsIntegration } = await (supabase as any).from('integrations')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('name', '__objects__')
          .maybeSingle()

        let objectsIntegrationId = objectsIntegration?.id
        if (!objectsIntegrationId) {
          const { data: createdIntegration, error: createIntegrationError } = await (supabase as any).from('integrations').insert({
            tenant_id: tenantId,
            name: '__objects__',
            type: 'rest_api',
            config: { base_url: 'internal://objects', _executor: 'object' },
            is_active: true,
          }).select('id').single()
          if (createIntegrationError || !createdIntegration?.id) {
            throw new Error(createIntegrationError?.message ?? 'Failed to create internal objects integration')
          }
          objectsIntegrationId = createdIntegration.id
          idMaps.integration.__objects__ = createdIntegration.id
          created.integrations.push(createdIntegration)
        }

        const generatedReferenceName = objectDef.generated_reference_name ?? `Object: ${objectDef.name}`
        const { data: generatedReference, error: generatedReferenceError } = await (supabase as any).from('integration_references').insert({
          tenant_id: tenantId,
          integration_id: objectsIntegrationId,
          name: generatedReferenceName,
          description: objectDef.description ?? `Composite object ${objectDef.name}`,
          request_config: { _executor: 'object', method: 'GET', operation: 'list', object_id: objectRow.id },
          inputs: [],
          outputs,
        }).select('*').single()
        if (generatedReferenceError || !generatedReference) {
          throw new Error(generatedReferenceError?.message ?? 'Failed to create generated object reference')
        }

        if (objectDef.generated_reference_id) {
          idMaps.reference[objectDef.generated_reference_id] = generatedReference.id
          onAssetWritten?.('reference', objectDef.generated_reference_id, generatedReference.id)
        }

        created.objects.push({
          ...objectRow,
          source_ids: (sourceRows ?? []).map((row: any) => row.id),
          generated_reference_id: generatedReference.id,
        })
      })
    }

    for (const table of manifest.decision_tables ?? []) {
      await guardAsset('decision_table', table?.id, async () => {
        const normalizedTable = normalizeScaffoldDecisionTable(table)
        const existing = await findExistingForUpsert('decision_tables', 'decision_table', table.id)
        const data = await writeAssetRow({
          table: 'decision_tables',
          mapName: 'decision_table',
          sourceId: table.id,
          existing,
          failureMessage: 'Failed to import decision table',
          payload: {
            tenant_id: tenantId,
            name: normalizedTable.name,
            description: normalizedTable.description ?? null,
            inputs: cloneJson(normalizedTable.inputs ?? []),
            outputs: cloneJson(normalizedTable.outputs ?? []),
            rules: remapKnownIds(cloneJson(normalizedTable.rules ?? []), idMaps),
          },
        })
        if (!existing) {
          idMaps.decision_table[table.id] = data.id
          onAssetWritten?.('decision_table', table.id, data.id)
          created.decision_tables.push(data)
        }
      })
    }

    for (const policy of manifest.retention_policies ?? []) {
      await guardAsset('retention_policy', policy?.id, async () => {
        const existing = await findExistingForUpsert('retention_policies', 'retention_policy', policy.id)
        const data = await writeAssetRow({
          table: 'retention_policies',
          mapName: 'retention_policy',
          sourceId: policy.id,
          existing,
          failureMessage: 'Failed to import retention policy',
          payload: {
            tenant_id: tenantId,
            name: policy.name,
            description: policy.description ?? null,
            policy_mode: policy.policy_mode,
            duration_value: policy.duration_value ?? null,
            duration_unit: policy.duration_unit ?? null,
            exact_date: policy.exact_date ?? null,
            applies_to: Array.isArray(policy.applies_to) && policy.applies_to.length > 0
              ? policy.applies_to
              : ['data_tables', 'data_rows', 'roles'],
            created_by: actingUserId ?? null,
            updated_by: actingUserId ?? null,
          },
        })
        if (!existing) {
          idMaps.retention_policy[policy.id] = data.id
          onAssetWritten?.('retention_policy', policy.id, data.id)
          created.retention_policies.push(data)
        }
      })
    }

    // Custom roles ride after retention policies so their retention_policy_id
    // remaps against freshly imported policies.
    for (const role of manifest.roles ?? []) {
      await guardAsset('role', role?.id, async () => {
        // System roles never travel (export filters them out); a manifest row
        // flagged is_system is ignored outright rather than imported.
        if (role?.is_system) return
        const slug = role.slug ?? String(role.name ?? 'role').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
        let existing = await findExistingForUpsert('roles', 'role', role.id)
        // Roles carry a tenant-unique slug, so upsert also matches by slug:
        // an unseeded import updates the local role with the same slug
        // instead of colliding with the uniqueness constraint.
        if (!existing && mode === 'upsert' && slug) {
          const { data: bySlug } = await (supabase as any)
            .from('roles')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('slug', slug)
            .maybeSingle()
          existing = bySlug ?? null
        }
        // NEVER touch existing system roles, even on a slug collision.
        if (existing?.is_system) return
        const data = await writeAssetRow({
          table: 'roles',
          mapName: 'role',
          sourceId: role.id,
          existing,
          failureMessage: 'Failed to import role',
          payload: {
            tenant_id: tenantId,
            name: role.name,
            slug,
            description: role.description ?? null,
            permissions: role.permissions ?? [],
            is_system: false,
            retention_policy_id: role.retention_policy_id ? (idMaps.retention_policy[role.retention_policy_id] ?? role.retention_policy_id) : null,
          },
        })
        // Slug-matched updates are not in the id-map seed, so the mapping is
        // recorded on BOTH paths — role_id references elsewhere in the
        // manifest must remap either way.
        idMaps.role[role.id] = data.id
        if (!existing) {
          onAssetWritten?.('role', role.id, data.id)
          created.roles.push(data)
        }
      })
    }

    for (const server of manifest.mcp_servers ?? []) {
      await guardAsset('mcp_server', server?.id, async () => {
        let existing = await findExistingForUpsert('mcp_servers', 'mcp_server', server.id)
        // Upsert also matches by name (per tenant) so unseeded imports update
        // the matching server instead of duplicating it.
        if (!existing && mode === 'upsert' && server.name) {
          const { data: byName } = await (supabase as any)
            .from('mcp_servers')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('name', server.name)
            .maybeSingle()
          existing = byName ?? null
        }
        const data = await writeAssetRow({
          table: 'mcp_servers',
          mapName: 'mcp_server',
          sourceId: server.id,
          existing,
          failureMessage: 'Failed to import MCP server',
          payload: {
            tenant_id: tenantId,
            name: server.name,
            url: server.url,
            auth_type: server.auth_type ?? 'none',
            // '__SECRET__' placeholders inside auth_config resolve against
            // the existing row on update and are dropped on insert, exactly
            // like integration credentials (handled inside writeAssetRow).
            auth_config: cloneJson(server.auth_config ?? {}),
            is_active: server.is_active ?? true,
          },
        })
        // Name-matched updates are not in the id-map seed; record the mapping
        // on both paths so mcp_server_id references remap either way.
        idMaps.mcp_server[server.id] = data.id
        if (!existing) {
          onAssetWritten?.('mcp_server', server.id, data.id)
          created.mcp_servers.push(data)
        }
      })
    }

    for (const activity of manifest.workflow_activities ?? []) {
      await guardAsset('workflow_activity', activity?.id, async () => {
        const existing = await findExistingForUpsert('custom_workflow_activities', 'workflow_activity', activity.id)
        const data = await writeAssetRow({
          table: 'custom_workflow_activities',
          mapName: 'workflow_activity',
          sourceId: activity.id,
          existing,
          failureMessage: 'Failed to import workflow activity',
          payload: {
            tenant_id: tenantId,
            name: activity.name,
            description: activity.description ?? null,
            key: activity.key,
            status: activity.status ?? 'draft',
            source_kind: activity.source_kind ?? 'inline',
            version: activity.version ?? '1.0.0',
            icon_name: activity.icon_name ?? 'Puzzle',
            color: activity.color ?? '#0EA5E9',
            source_code: activity.source_code ?? '',
            manifest: cloneJson(activity.manifest ?? { inputs: [], outputs: [] }),
            demo_inputs: cloneJson(activity.demo_inputs ?? {}),
            tags: activity.tags ?? [],
            source_filename: activity.source_filename ?? null,
            created_by: actingUserId ?? null,
            updated_by: actingUserId ?? null,
          },
        })
        if (!existing) {
          idMaps.workflow_activity[activity.id] = data.id
          onAssetWritten?.('workflow_activity', activity.id, data.id)
          created.workflow_activities.push(data)
        }
      })
    }

    for (const report of manifest.reports ?? []) {
      await guardAsset('report', report?.id, async () => {
        // Normalize first (aliases `source` → `data_source`), THEN
        // remap. If the LLM double-encoded config as a string, parse
        // it first. Also check for source/data_source at the report
        // level (not inside config) and carry it through.
        let rawConfig = report.config ?? {}
        if (typeof rawConfig === 'string') {
          try { rawConfig = JSON.parse(rawConfig) } catch { rawConfig = {} }
        }
        // LLMs sometimes put source at the report level, not inside config
        if (!rawConfig.source && !rawConfig.data_source && !rawConfig.dataSource) {
          const reportSource = report.source ?? report.data_source ?? report.dataSource
          if (reportSource) rawConfig.data_source = reportSource
        }
        const normalizedConfig = remapKnownIds(cloneJson(normalizeScaffoldReportConfig(rawConfig)), idMaps)
        const existing = await findExistingForUpsert('reports', 'report', report.id)
        const data = await writeAssetRow({
          table: 'reports',
          mapName: 'report',
          sourceId: report.id,
          existing,
          failureMessage: 'Failed to import report',
          payload: {
            tenant_id: tenantId,
            created_by: actingUserId ?? null,
            name: report.name,
            description: report.description ?? null,
            category: report.category ?? null,
            is_shared: report.is_shared ?? false,
            config: normalizedConfig,
          },
        })
        if (!existing) {
          idMaps.report[report.id] = data.id
          onAssetWritten?.('report', report.id, data.id)
          created.reports.push(data)
        }
      })
    }

    for (const agent of manifest.agents ?? []) {
      await guardAsset('agent', agent?.id, async () => {
        const tools = Array.isArray(agent.tools) ? agent.tools.map((toolId: string) => idMaps.reference[toolId] ?? toolId) : []
        const existing = await findExistingForUpsert('agents', 'agent', agent.id)
        const data = await writeAssetRow({
          table: 'agents',
          mapName: 'agent',
          sourceId: agent.id,
          existing,
          failureMessage: 'Failed to import agent',
          payload: {
            tenant_id: tenantId,
            name: agent.name,
            description: agent.description ?? null,
            model: agent.model ?? 'gpt-4o',
            system_prompt: agent.system_prompt ?? '',
            role: agent.role ?? '',
            task: agent.task ?? '',
            boundaries: agent.boundaries ?? '',
            tools,
            output_config: remapKnownIds(cloneJson(agent.output_config ?? { variables: [] }), idMaps),
            integration_id: agent.integration_id ? (idMaps.integration[agent.integration_id] ?? null) : null,
            is_active: agent.is_active ?? true,
          },
        })
        if (!existing) {
          idMaps.agent[agent.id] = data.id
          onAssetWritten?.('agent', agent.id, data.id)
          created.agents.push(data)
        }
      })
    }

    // Saved form themes, then forms (a form's theme may be a saved theme:
    // theme_id remaps), then workflows (nodes link forms: form_id remaps).
    // Written through the forms service: validation, versions (a content
    // change is a new version here; the number never travels).
    for (const theme of manifest.form_themes ?? []) {
      await guardAsset('form_theme', theme?.id, async () => {
        const existing = await findExistingForUpsert('form_themes', 'form_theme', theme.id)
        const data = await applyFormThemeManifest(serviceContext, cloneJson(theme), existing?.id ?? null)
        idMaps.form_theme[theme.id] = data.id
        if (existing) {
          updatedCounts.form_theme = (updatedCounts.form_theme ?? 0) + 1
        } else {
          onAssetWritten?.('form_theme', theme.id, data.id)
          created.form_themes.push({ id: data.id })
        }
      })
    }

    // A form button may start a workflow of this same manifest, which is
    // written after the forms (workflows link forms). Such forms are written
    // without those actions first and get their buttons, remapped, once the
    // workflows exist.
    const manifestWorkflowIds = new Set<string>((manifest.workflows ?? []).map((w: any) => String(w?.id ?? '')))
    const startsManifestWorkflow = (action: any) => action?.type === 'start_workflow' && manifestWorkflowIds.has(String(action.workflow_id ?? '')) && !idMaps.workflow[String(action.workflow_id)]
    const deferredButtons: Array<{ asset: Record<string, any>; localId: string; buttons: unknown[] }> = []
    for (const form of portableForms) {
      await guardAsset('form', form?.id, async () => {
        const existing = await findExistingForUpsert('forms', 'form', form.id)
        const asset = remapKnownIds(cloneJson(form), idMaps)
        const deferred = Array.isArray(asset.buttons) && asset.buttons.some((b: any) => (b?.actions ?? []).some(startsManifestWorkflow)) ? cloneJson(form.buttons) as unknown[] : null
        if (deferred) asset.buttons = asset.buttons.map((b: any) => ({ ...b, actions: (b?.actions ?? []).filter((a: any) => !startsManifestWorkflow(a)) }))
        // A saved theme that is neither in the manifest nor in this
        // workspace: the form falls back to the workspace theme.
        if (asset.theme?.source === 'saved') {
          const { data: theme } = await (supabase as any).from('form_themes').select('id')
            .eq('id', String(asset.theme.theme_id ?? '')).eq('tenant_id', tenantId).maybeSingle()
          if (!theme) {
            asset.theme = { source: 'workspace' }
            importWarnings.push({ asset_type: 'form', source_id: String(form.id ?? ''), warning: `Form "${form.name}" uses a saved form theme that is not in this workspace; it uses the workspace theme instead` })
          }
        }
        const withImage = await restoreFormHeaderImage(serviceContext, asset)
        const data = await applyFormManifest(serviceContext, withImage, existing?.id ?? null)
        idMaps.form[form.id] = data.id
        if (deferred) deferredButtons.push({ asset: withImage, localId: String(data.id), buttons: deferred })
        if (existing) {
          updatedCounts.form = (updatedCounts.form ?? 0) + 1
        } else {
          onAssetWritten?.('form', form.id, data.id)
          created.forms.push({ id: data.id })
        }
      })
    }

    // Sub-workflows first: a parent's call_sub_workflow node is remapped when
    // it is written, so its child must already have a local id. Cycles (two
    // workflows calling each other) are patched after the loop.
    const writtenWorkflows: Array<{ source: any; localId: string; nodes: unknown }> = []
    for (const workflow of orderWorkflowsByDependencies<any>(manifest.workflows ?? [])) {
      await guardAsset('workflow', workflow?.id, async () => {
        // Drafts follow the latest form version: pins (published snapshots only) are dropped.
        const normalizedWorkflow = stripWorkflowFormPins(normalizeScaffoldWorkflow(workflow))
        const nodes = remapKnownIds(cloneJson(normalizedWorkflow.nodes ?? []), idMaps)
        const edges = remapKnownIds(cloneJson(normalizedWorkflow.edges ?? []), idMaps)
        const triggerConfig: Record<string, any> = remapKnownIds(cloneJson(normalizedWorkflow.trigger_config ?? {}), idMaps)
        const userVariables = remapKnownIds(cloneJson(normalizedWorkflow.user_variables ?? []), idMaps)
        const swimlanes = remapKnownIds(cloneJson(normalizedWorkflow.swimlanes ?? []), idMaps)

        const triggerType = normalizedWorkflow.trigger_type ?? 'manual'

        const existing = await findExistingForUpsert('workflows', 'workflow', workflow.id)
        const data = await writeAssetRow({
          table: 'workflows',
          mapName: 'workflow',
          sourceId: workflow.id,
          existing,
          failureMessage: 'Failed to import workflow',
          payload: {
            tenant_id: tenantId,
            created_by: actingUserId ?? null,
            name: normalizedWorkflow.name,
            description: normalizedWorkflow.description ?? null,
            trigger_type: triggerType,
            trigger_config: triggerConfig,
            nodes,
            edges,
            user_variables: userVariables,
            swimlanes,
            is_active: workflow.is_active ?? false,
          },
        })
        if (!existing) {
          idMaps.workflow[workflow.id] = data.id
          onAssetWritten?.('workflow', workflow.id, data.id)
          created.workflows.push(data)
        }
        writtenWorkflows.push({ source: normalizedWorkflow, localId: String(data.id), nodes })
      })
    }
    for (const written of writtenWorkflows) {
      const nodes = remapKnownIds(cloneJson(written.source.nodes ?? []), idMaps)
      if (JSON.stringify(nodes) === JSON.stringify(written.nodes)) continue
      const { error } = await (supabase as any).from('workflows').update({ nodes }).eq('id', written.localId).eq('tenant_id', tenantId)
      if (error) throw new Error(error.message)
    }
    // Forms whose buttons start workflows of this manifest: their buttons, now that the workflows exist.
    for (const pending of deferredButtons) {
      await guardAsset('form', String(pending.asset.id ?? ''), async () => {
        await applyFormManifest(serviceContext, { ...pending.asset, buttons: remapKnownIds(cloneJson(pending.buttons), idMaps) }, pending.localId)
      })
    }

    // Log destinations last: their filters may name workflows (workflow_ids
    // remap). Written through the service: credentials merge, and a
    // destination without its secret is created disabled with a warning.
    for (const destination of manifest.log_destinations ?? []) {
      await guardAsset('log_destination', destination?.id, async () => {
        const existing = await findExistingForUpsert('log_destinations', 'log_destination', destination.id)
        const result = await applyLogDestinationManifest(serviceContext, remapKnownIds(cloneJson(destination), idMaps), existing?.id ?? null)
        idMaps.log_destination[destination.id] = result.id
        for (const warning of result.warnings) importWarnings.push({ asset_type: 'log_destination', source_id: String(destination.id ?? ''), warning })
        if (result.created) {
          onAssetWritten?.('log_destination', destination.id, result.id)
          created.log_destinations.push({ id: result.id })
        } else {
          updatedCounts.log_destination = (updatedCounts.log_destination ?? 0) + 1
        }
      })
    }

    // Kanban was retired. Old manifests may still carry a kanban_boards
    // section — skip it and surface the count, as for spaces below.
    if (Array.isArray(manifest.kanban_boards) && manifest.kanban_boards.length > 0) {
      importWarnings.push({
        asset_type: 'kanban_board',
        source_id: 'manifest',
        warning: `Skipped ${manifest.kanban_boards.length} kanban board(s): the Kanban feature was retired`,
      })
    }

    // Spaces were retired.
    // Old manifests may still carry a spaces section — skip it rather than
    // fail, and surface the count so imports are honest about what dropped.
    if (Array.isArray(manifest.spaces) && manifest.spaces.length > 0) {
      importWarnings.push({
        asset_type: 'space',
        source_id: 'manifest',
        warning: `Skipped ${manifest.spaces.length} space(s): the Spaces feature was retired`,
      })
    }

    // Apps were retired. Old manifests may still carry an apps (or
    // projects) section — skip it and surface the count.
    const retiredApps = Array.isArray(manifest.apps) ? manifest.apps : Array.isArray(manifest.projects) ? manifest.projects : []
    if (retiredApps.length > 0) {
      importWarnings.push({
        asset_type: 'app',
        source_id: 'manifest',
        warning: `Skipped ${retiredApps.length} app(s): the Apps feature was retired`,
      })
    }

    // The old Forms (a different shape: no field list), pages, themes and
    // web components were retired. Old manifests may still carry those
    // sections — skip them and surface the counts. (Today's reusable task
    // forms and form_themes are imported above.)
    if (retiredForms.length > 0) {
      importWarnings.push({
        asset_type: 'form',
        source_id: 'manifest',
        warning: `Skipped ${retiredForms.length} form(s): the Forms and Pages features were retired`,
      })
    }
    const retiredFormSections: Array<[string, string, string]> = [
      ['pages', 'page', 'page(s)'],
      ['themes', 'theme', 'form theme(s)'],
      ['web_components', 'web_component', 'web component(s)'],
    ]
    for (const [section, assetType, label] of retiredFormSections) {
      if (Array.isArray(manifest[section]) && manifest[section].length > 0) {
        importWarnings.push({
          asset_type: assetType,
          source_id: 'manifest',
          warning: `Skipped ${manifest[section].length} ${label}: the Forms and Pages features were retired`,
        })
      }
    }

    // Documents and metadata templates were retired. Old manifests may still
    // carry those sections — skip them and surface the counts.
    const retiredDocumentSections: Array<[string, string, string]> = [
      ['document_folders', 'document_folder', 'document folder(s)'],
      ['documents', 'document', 'document(s)'],
      ['document_metadata_templates', 'metadata_template', 'metadata template(s)'],
    ]
    for (const [section, assetType, label] of retiredDocumentSections) {
      if (Array.isArray(manifest[section]) && manifest[section].length > 0) {
        importWarnings.push({
          asset_type: assetType,
          source_id: 'manifest',
          warning: `Skipped ${manifest[section].length} ${label}: the Documents feature was retired`,
        })
      }
    }

    return {
      created,
      id_map: idMaps,
      counts: Object.fromEntries(Object.entries(created).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0])),
      // Only upsert runs report update counts and per-asset errors, so
      // create-mode results stay byte-identical for existing callers.
      ...(mode === 'upsert' ? { updated: updatedCounts, errors: upsertErrors } : {}),
      // Non-fatal notes (both modes): skipped retired sections. Omitted when
      // empty so pre-existing result shapes are untouched.
      ...(importWarnings.length > 0 ? { warnings: importWarnings } : {}),
    }
  } catch (error) {
    await rollbackCreatedAssets()
    throw error
  }
}

export type ImportTenantManifestParams = {
  supabase: any
  tenantId: string
  actingUserId?: string | null
  /** A format_version: 3 tenant manifest from buildTenantExport. */
  manifest: Record<string, any>
  mode?: 'create' | 'upsert'
  idMapSeed?: AssetIdMaps
  onAssetWritten?: (assetType: string, sourceId: string, localId: string) => void
  serviceContext?: ServiceContext
}

/**
 * Import a tenant-level manifest.
 *
 * Insertion order follows importManifest (email templates → connectors → data tables →
 * integrations/references → objects → business rules → retention policies →
 * roles → mcp servers → workflow activities → reports → agents → form themes →
 * forms → workflows → log destinations).
 *
 * Scrub resolution: in create mode there is no existing record to resolve
 * '__SECRET__' placeholders against, so those values are dropped and the
 * assets are created without credentials. In upsert mode placeholders are
 * left in place here and importManifest resolves each one from the existing
 * row's value at the same path before updating.
 */
export async function importTenantManifest(params: ImportTenantManifestParams) {
  const mode = params.mode ?? 'create'

  const manifest = mode === 'create'
    ? resolveSecretPlaceholders(cloneJson(params.manifest))
    : cloneJson(params.manifest)

  return importManifest({
    supabase: params.supabase,
    tenantId: params.tenantId,
    actingUserId: params.actingUserId,
    manifest,
    mode,
    idMapSeed: params.idMapSeed,
    onAssetWritten: params.onAssetWritten,
    serviceContext: params.serviceContext,
  })
}
