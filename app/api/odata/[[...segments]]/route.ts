import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey, requireApiPermission, err, type ApiKeySuccessResult } from '@/lib/api-auth'
import { enqueueDataTableEventWorkflows } from '@/lib/data-table-workflow-triggers'
import { canAccessTable, hasTableScope } from '@/lib/api-key-permissions'
import {
  applyODataFilter,
  applyODataOrderBy,
  applyODataSelect,
  buildAutoPopulatedRowData,
  buildCollectionResponse,
  buildCreateOrUpdatePayload,
  buildEntity,
  buildMetadataXml,
  buildRowContext,
  buildServiceDocument,
  getODataCollectionName,
  getODataEntityTypeName,
  normalizeTableColumns,
  parseEntityRequestSegment,
} from '@/lib/odata'
import { executeReportPreview } from '@/lib/mcp/tools/reports'
import { listTenantReportSources } from '@/lib/report-source-registry'

type RouteContext = { params: Promise<{ segments?: string[] }> }

const REPORTS_COLLECTION_NAME = 'SavedReports'
const REPORT_SOURCES_COLLECTION_NAME = 'ReportSources'
const REPORT_RESULTS_COLLECTION_NAME = 'SavedReportResults'
const ODATA_NAMESPACE = 'UserTasks.OData'
const REPORT_COLLECTION_NAMES = new Set([REPORTS_COLLECTION_NAME, REPORT_SOURCES_COLLECTION_NAME, REPORT_RESULTS_COLLECTION_NAME])

// OData is a data feed, so it follows the same RBAC as the rest of the API:
// table rows need data.view (reads) / data.manage_rows (writes) on top of the
// per-key table allowlist; the report collections need reports.view. The
// service document and $metadata are discoverable with either read
// permission, but only list custom tables when the key holds data.view.
function canViewData(auth: ApiKeySuccessResult) {
  return auth.permissions.includes('data.view')
}

function canViewReports(auth: ApiKeySuccessResult) {
  return auth.permissions.includes('reports.view')
}

function getExtraEntitySets() {
  return [
    {
      name: REPORTS_COLLECTION_NAME,
      title: 'Saved Reports',
      metadata: { asset_type: 'report' },
    },
    {
      name: REPORT_SOURCES_COLLECTION_NAME,
      title: 'Report Sources',
      metadata: { asset_type: 'report_source' },
    },
    {
      name: REPORT_RESULTS_COLLECTION_NAME,
      title: 'Saved Report Results',
      metadata: { asset_type: 'report_result' },
    },
  ]
}

async function fetchSavedReports(supabase: any, tenantId: string) {
  const { data, error } = await (supabase as any)
    .from('reports')
    .select('id, name, description, category, is_shared, is_favorite, config, created_at, updated_at, created_by')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((report: any) => ({
    ReportId: String(report.id),
    Name: report.name ?? '',
    Description: report.description ?? null,
    Category: report.category ?? null,
    IsShared: Boolean(report.is_shared),
    IsFavorite: Boolean(report.is_favorite),
    DataSource: report.config?.data_source ?? null,
    Visualization: report.config?.visualization ?? 'table',
    RowLimit: typeof report.config?.row_limit === 'number' ? report.config.row_limit : null,
    CreatedBy: report.created_by ?? null,
    CreatedAt: report.created_at ?? null,
    UpdatedAt: report.updated_at ?? null,
    ODataResultsPath: `${REPORT_RESULTS_COLLECTION_NAME}?$filter=ReportId eq '${encodeURIComponent(String(report.id))}'`,
    ReportPath: `/reports/${report.id}`,
  }))
}

async function fetchReportSources(supabase: any, tenantId: string) {
  const sources = await listTenantReportSources(supabase, tenantId)

  return sources.map((source: any) => ({
    SourceKey: String(source.key),
    Label: source.label ?? source.key,
    Description: source.description ?? null,
    Category: source.category ?? 'General',
    ColumnCount: Array.isArray(source.columns) ? source.columns.length : 0,
    IsDynamic: Boolean(source.dynamic),
    IsVirtual: Boolean(source.virtual),
    IsSchemaFlexible: Boolean(source.schemaFlexible),
    DefaultSortField: source.defaultSort?.field ?? null,
    DefaultSortDirection: source.defaultSort?.direction ?? null,
    ColumnsJson: JSON.stringify(
      (source.columns ?? []).map((column: any) => ({
        key: column.key,
        label: column.label,
        type: column.type,
        join: column.join ?? null,
      })),
    ),
  }))
}

async function getExtraCollectionRows(supabase: any, tenantId: string, collectionName: string) {
  if (collectionName === REPORTS_COLLECTION_NAME) return fetchSavedReports(supabase, tenantId)
  if (collectionName === REPORT_SOURCES_COLLECTION_NAME) return fetchReportSources(supabase, tenantId)
  return null
}

function extractReportIdFilter(filter: string | null) {
  if (!filter) return null
  const match = filter.match(/\bReportId\s+eq\s+'([^']+)'\b/i)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

async function fetchSavedReportResults(supabase: any, tenantId: string, params: {
  reportId?: string | null
  maxReports?: number
  maxRowsPerReport?: number
}) {
  let query = (supabase as any)
    .from('reports')
    .select('id, name, category, config, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(Math.max(params.maxReports ?? 20, 1), 50))

  if (params.reportId) query = query.eq('id', params.reportId)

  const { data: reports, error } = await query
  if (error) throw error

  const rows: Record<string, any>[] = []
  for (const report of reports ?? []) {
    try {
      const preview = await executeReportPreview(supabase, tenantId, report.config ?? {})
      const reportRows = Array.isArray(preview.data) ? preview.data : []
      const maxRowsPerReport = Math.min(Math.max(params.maxRowsPerReport ?? 500, 1), 2000)
      reportRows.slice(0, maxRowsPerReport).forEach((row, index) => {
        const scalarMetrics = Object.fromEntries(
          Object.entries(row ?? {}).filter(([, value]) => {
            return value == null || ['string', 'number', 'boolean'].includes(typeof value)
          }),
        )
        rows.push({
          ResultId: `${report.id}:${index + 1}`,
          ReportId: String(report.id),
          ReportName: report.name ?? '',
          Category: report.category ?? null,
          DataSource: report.config?.data_source ?? null,
          Visualization: report.config?.visualization ?? 'table',
          RowIndex: index + 1,
          MetricsJson: JSON.stringify(row ?? {}),
          ScalarMetricsJson: JSON.stringify(scalarMetrics),
          ColumnsJson: JSON.stringify(Object.keys(row ?? {})),
          ReportUpdatedAt: report.updated_at ?? null,
        })
      })
    } catch (executionError: any) {
      rows.push({
        ResultId: `${report.id}:error`,
        ReportId: String(report.id),
        ReportName: report.name ?? '',
        Category: report.category ?? null,
        DataSource: report.config?.data_source ?? null,
        Visualization: report.config?.visualization ?? 'table',
        RowIndex: 0,
        MetricsJson: JSON.stringify({ error: executionError?.message ?? 'Failed to execute report' }),
        ScalarMetricsJson: JSON.stringify({}),
        ColumnsJson: JSON.stringify([]),
        ReportUpdatedAt: report.updated_at ?? null,
      })
    }
  }

  return rows
}

function buildExtraCollectionResponse(params: {
  baseUrl: string
  collectionName: string
  rows: Record<string, any>[]
  count?: number
}) {
  return {
    '@odata.context': `${params.baseUrl}/$metadata#${params.collectionName}`,
    ...(typeof params.count === 'number' ? { '@odata.count': params.count } : {}),
    value: params.rows.map((row) => ({
      '@odata.id': `${params.baseUrl}/${params.collectionName}('${encodeURIComponent(String(row.ReportId ?? row.SourceKey ?? ''))}')`,
      ...row,
    })),
  }
}

function buildExtraEntityResponse(params: {
  baseUrl: string
  collectionName: string
  entityId: string
  row: Record<string, any>
}) {
  return {
    '@odata.context': `${params.baseUrl}/$metadata#${params.collectionName}/$entity`,
    '@odata.id': `${params.baseUrl}/${params.collectionName}('${encodeURIComponent(params.entityId)}')`,
    ...params.row,
  }
}

function getBaseUrl(request: NextRequest) {
  return `${request.nextUrl.protocol}//${request.nextUrl.host}/api/odata`
}

function odataJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'OData-Version': '4.0',
      ...(init?.headers ?? {}),
    },
  })
}

async function getTableByCollectionName(supabase: any, tenantId: string, collectionName: string) {
  const { data: tables, error } = await supabase
    .from('custom_tables')
    .select('id, name, slug, columns, tenant_id')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) throw error
  return (tables ?? []).find((table: any) => getODataCollectionName(table) === collectionName) ?? null
}

async function fetchRowsForTable(
  supabase: any,
  tenantId: string,
  tableId: string,
  options?: { offset?: number; limit?: number },
) {
  let query = supabase
    .from('custom_table_rows')
    .select('id, data, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('table_id', tableId)
    .order('created_at', { ascending: false })

  if (typeof options?.offset === 'number' && typeof options?.limit === 'number') {
    query = query.range(options.offset, options.offset + options.limit - 1)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Array<{ id: string; data: Record<string, any>; created_at?: string; updated_at?: string }>
}

function parseRequestSegments(segments: string[]) {
  if (segments.length === 0) return { kind: 'service' as const }
  if (segments.length === 1 && segments[0] === '$metadata') return { kind: 'metadata' as const }

  const [first, second] = segments
  const parsed = parseEntityRequestSegment(first)
  if (parsed.entityId) {
    return { kind: 'entity' as const, collectionName: parsed.collectionName, entityId: parsed.entityId }
  }
  if (segments.length >= 2 && second) {
    return { kind: 'entity' as const, collectionName: parsed.collectionName, entityId: decodeURIComponent(second) }
  }
  return { kind: 'collection' as const, collectionName: parsed.collectionName }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const { tenantId, supabase } = auth
  const { segments = [] } = await context.params
  const baseUrl = getBaseUrl(request)
  const parsed = parseRequestSegments(segments)

  if ((parsed.kind === 'service' || parsed.kind === 'metadata') && !canViewData(auth) && !canViewReports(auth)) {
    return err("Forbidden: this API key lacks the 'data.view' permission", 403)
  }

  if (parsed.kind === 'service') {
    let query = supabase
      .from('custom_tables')
      .select('id, name, slug')
      .eq('tenant_id', tenantId)
      .order('name')
    if (hasTableScope(auth)) query = query.in('id', auth.scopes.table_ids)
    const { data: tables, error } = canViewData(auth) ? await query : { data: [], error: null }
    if (error) return err(error.message, 500)
    return odataJson(buildServiceDocument({ baseUrl, tables: tables ?? [], extras: getExtraEntitySets() }))
  }

  if (parsed.kind === 'metadata') {
    let query = supabase
      .from('custom_tables')
      .select('id, name, slug, columns')
      .eq('tenant_id', tenantId)
      .order('name')
    if (hasTableScope(auth)) query = query.in('id', auth.scopes.table_ids)
    const { data: tables, error } = canViewData(auth) ? await query : { data: [], error: null }
    if (error) return err(error.message, 500)
    const xml = buildMetadataXml({
      namespace: ODATA_NAMESPACE,
      baseUrl,
      tables: tables ?? [],
      extras: [
        {
          entitySetName: REPORTS_COLLECTION_NAME,
          entityTypeName: 'SavedReport',
          keyName: 'ReportId',
          properties: [
            { name: 'ReportId', type: 'Edm.String', nullable: false },
            { name: 'Name', type: 'Edm.String' },
            { name: 'Description', type: 'Edm.String' },
            { name: 'Category', type: 'Edm.String' },
            { name: 'IsShared', type: 'Edm.Boolean' },
            { name: 'IsFavorite', type: 'Edm.Boolean' },
            { name: 'DataSource', type: 'Edm.String' },
            { name: 'Visualization', type: 'Edm.String' },
            { name: 'RowLimit', type: 'Edm.Int32' },
            { name: 'CreatedBy', type: 'Edm.String' },
            { name: 'CreatedAt', type: 'Edm.DateTimeOffset' },
            { name: 'UpdatedAt', type: 'Edm.DateTimeOffset' },
            { name: 'ODataResultsPath', type: 'Edm.String' },
            { name: 'ReportPath', type: 'Edm.String' },
          ],
        },
        {
          entitySetName: REPORT_SOURCES_COLLECTION_NAME,
          entityTypeName: 'ReportSource',
          keyName: 'SourceKey',
          properties: [
            { name: 'SourceKey', type: 'Edm.String', nullable: false },
            { name: 'Label', type: 'Edm.String' },
            { name: 'Category', type: 'Edm.String' },
            { name: 'ColumnCount', type: 'Edm.Int32' },
            { name: 'IsDynamic', type: 'Edm.Boolean' },
            { name: 'IsVirtual', type: 'Edm.Boolean' },
            { name: 'DefaultSortField', type: 'Edm.String' },
            { name: 'DefaultSortDirection', type: 'Edm.String' },
            { name: 'ColumnsJson', type: 'Edm.String' },
          ],
        },
        {
          entitySetName: REPORT_RESULTS_COLLECTION_NAME,
          entityTypeName: 'SavedReportResult',
          keyName: 'ResultId',
          properties: [
            { name: 'ResultId', type: 'Edm.String', nullable: false },
            { name: 'ReportId', type: 'Edm.String' },
            { name: 'ReportName', type: 'Edm.String' },
            { name: 'Category', type: 'Edm.String' },
            { name: 'DataSource', type: 'Edm.String' },
            { name: 'Visualization', type: 'Edm.String' },
            { name: 'RowIndex', type: 'Edm.Int32' },
            { name: 'MetricsJson', type: 'Edm.String' },
            { name: 'ScalarMetricsJson', type: 'Edm.String' },
            { name: 'ColumnsJson', type: 'Edm.String' },
            { name: 'ReportUpdatedAt', type: 'Edm.DateTimeOffset' },
          ],
        },
      ],
    })
    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'OData-Version': '4.0',
      },
    })
  }

  const search = request.nextUrl.searchParams
  const filter = search.get('$filter')
  const orderBy = search.get('$orderby')
  const select = search.get('$select')
  const top = Math.min(Math.max(Number(search.get('$top') ?? '100'), 1), 500)
  const skip = Math.max(Number(search.get('$skip') ?? '0'), 0)
  const includeCount = search.get('$count') === 'true'

  const forbiddenRead = requireApiPermission(auth, REPORT_COLLECTION_NAMES.has(parsed.collectionName) ? 'reports.view' : 'data.view')
  if (forbiddenRead) return forbiddenRead

  let extraRows = await getExtraCollectionRows(supabase, tenantId, parsed.collectionName)
  if (!extraRows && parsed.collectionName === REPORT_RESULTS_COLLECTION_NAME) {
    extraRows = await fetchSavedReportResults(supabase, tenantId, {
      reportId: extractReportIdFilter(filter),
      maxReports: 20,
      maxRowsPerReport: 500,
    })
  }
  if (extraRows) {
    if (parsed.kind === 'entity') {
      const row = extraRows.find((candidate: any) => String(candidate.ResultId ?? candidate.ReportId ?? candidate.SourceKey ?? '') === parsed.entityId)
      if (!row) return err('Entity not found', 404)
      const selected = applyODataSelect([row], select)[0] ?? row
      return odataJson(buildExtraEntityResponse({
        baseUrl,
        collectionName: parsed.collectionName,
        entityId: parsed.entityId,
        row: selected,
      }))
    }

    let entities = extraRows.map((row: any) => ({
      '@odata.id': `${baseUrl}/${parsed.collectionName}('${encodeURIComponent(String(row.ResultId ?? row.ReportId ?? row.SourceKey ?? ''))}')`,
      ...row,
    }))
    entities = applyODataFilter(entities, filter)
    entities = applyODataOrderBy(entities, orderBy)
    const totalCount = entities.length
    entities = entities.slice(skip, skip + top)
    entities = applyODataSelect(entities, select)

    return odataJson({
      '@odata.context': `${baseUrl}/$metadata#${parsed.collectionName}`,
      ...(includeCount ? { '@odata.count': totalCount } : {}),
      value: entities,
    })
  }

  const table = await getTableByCollectionName(supabase, tenantId, parsed.collectionName)
  if (!table) return err('Table not found', 404)
  if (!canAccessTable(auth, table.id)) return err('This API key is not allowed to access that table', 403)

  if (parsed.kind === 'entity') {
    const { data: row, error } = await supabase
      .from('custom_table_rows')
      .select('id, data, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .eq('table_id', table.id)
      .eq('id', parsed.entityId)
      .single()
    if (error || !row) return err('Row not found', 404)

    const entity = buildEntity({ baseUrl, table, row })
    return odataJson({
      '@odata.context': buildRowContext(baseUrl, parsed.collectionName, parsed.entityId),
      ...entity,
    })
  }

  const canUseDatabasePaging = !filter && !orderBy && !includeCount
  const rows = canUseDatabasePaging
    ? await fetchRowsForTable(supabase, tenantId, table.id, { offset: skip, limit: top })
    : await fetchRowsForTable(supabase, tenantId, table.id)
  let entities = rows.map((row) => buildEntity({ baseUrl, table, row }))
  if (!canUseDatabasePaging) {
    entities = applyODataFilter(entities, filter)
    entities = applyODataOrderBy(entities, orderBy)
  }
  const totalCount = canUseDatabasePaging ? undefined : entities.length
  if (!canUseDatabasePaging) entities = entities.slice(skip, skip + top)
  entities = applyODataSelect(entities, select)

  return odataJson({
    '@odata.context': `${baseUrl}/$metadata#${parsed.collectionName}`,
    ...(includeCount ? { '@odata.count': totalCount ?? entities.length } : {}),
    value: entities,
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const { tenantId, supabase } = auth
  const { segments = [] } = await context.params
  const baseUrl = getBaseUrl(request)
  const parsed = parseRequestSegments(segments)

  if (parsed.kind !== 'collection') return err('POST is only supported on entity collections', 405)
  const forbidden = requireApiPermission(auth, 'data.manage_rows')
  if (forbidden) return forbidden

  const table = await getTableByCollectionName(supabase, tenantId, parsed.collectionName)
  if (!table) return err('Table not found', 404)
  if (!canAccessTable(auth, table.id)) return err('This API key is not allowed to access that table', 403)

  const body = await request.json().catch(() => ({}))
  const existingRows = await supabase
    .from('custom_table_rows')
    .select('data')
    .eq('tenant_id', tenantId)
    .eq('table_id', table.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const payload = buildCreateOrUpdatePayload({
    body: body && typeof body === 'object' ? body : {},
    table,
  })
  const rowData = buildAutoPopulatedRowData({
    existingRows: existingRows.data ?? [],
    table,
    payload,
  })

  const { data: insertedRow, error } = await (supabase as any)
    .from('custom_table_rows')
    .insert({
      table_id: table.id,
      tenant_id: tenantId,
      data: rowData,
      created_by: null,
      updated_by: null,
    })
    .select('id, data, created_at, updated_at')
    .single()

  if (error || !insertedRow) return err(error?.message ?? 'Failed to create row', 500)

  await enqueueDataTableEventWorkflows({
    supabase,
    tenantId,
    tableId: table.id,
    rowId: insertedRow.id,
    rowData: rowData,
    eventType: 'created',
  })

  const entity = buildEntity({ baseUrl, table, row: insertedRow })
  return odataJson({
    '@odata.context': buildRowContext(baseUrl, parsed.collectionName, insertedRow.id),
    ...entity,
  }, {
    status: 201,
    headers: {
      'OData-Version': '4.0',
      Location: `${baseUrl}/${parsed.collectionName}('${encodeURIComponent(insertedRow.id)}')`,
    },
  })
}

async function updateEntity(request: NextRequest, context: RouteContext, replace = false) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const { tenantId, supabase } = auth
  const { segments = [] } = await context.params
  const baseUrl = getBaseUrl(request)
  const parsed = parseRequestSegments(segments)

  if (parsed.kind !== 'entity') return err('PATCH/PUT is only supported on a single row', 405)
  const forbidden = requireApiPermission(auth, 'data.manage_rows')
  if (forbidden) return forbidden

  const table = await getTableByCollectionName(supabase, tenantId, parsed.collectionName)
  if (!table) return err('Table not found', 404)
  if (!canAccessTable(auth, table.id)) return err('This API key is not allowed to access that table', 403)

  const { data: existingRow, error: fetchError } = await (supabase as any)
    .from('custom_table_rows')
    .select('id, data, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('table_id', table.id)
    .eq('id', parsed.entityId)
    .single()
  if (fetchError || !existingRow) return err('Row not found', 404)

  const body = await request.json().catch(() => ({}))
  const payload = buildCreateOrUpdatePayload({
    body: body && typeof body === 'object' ? body : {},
    table,
    existing: replace ? {} : ((existingRow.data as Record<string, any>) ?? {}),
  })

  const { data: updatedRow, error } = await (supabase as any)
    .from('custom_table_rows')
    .update({
      data: payload,
      updated_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('table_id', table.id)
    .eq('id', parsed.entityId)
    .select('id, data, created_at, updated_at')
    .single()

  if (error || !updatedRow) return err(error?.message ?? 'Failed to update row', 500)

  await enqueueDataTableEventWorkflows({
    supabase,
    tenantId,
    tableId: table.id,
    rowId: parsed.entityId,
    rowData: payload,
    eventType: 'updated',
  })

  const entity = buildEntity({ baseUrl, table, row: updatedRow })
    return odataJson({
      '@odata.context': buildRowContext(baseUrl, parsed.collectionName, parsed.entityId),
      ...entity,
    })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return updateEntity(request, context, false)
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return updateEntity(request, context, true)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const { tenantId, supabase } = auth
  const { segments = [] } = await context.params
  const parsed = parseRequestSegments(segments)

  if (parsed.kind !== 'entity') return err('DELETE is only supported on a single row', 405)
  const forbidden = requireApiPermission(auth, 'data.manage_rows')
  if (forbidden) return forbidden

  const table = await getTableByCollectionName(supabase, tenantId, parsed.collectionName)
  if (!table) return err('Table not found', 404)
  if (!canAccessTable(auth, table.id)) return err('This API key is not allowed to access that table', 403)

  const { data: existingRow, error: fetchError } = await (supabase as any)
    .from('custom_table_rows')
    .select('id, data')
    .eq('tenant_id', tenantId)
    .eq('table_id', table.id)
    .eq('id', parsed.entityId)
    .single()
  if (fetchError || !existingRow) return err('Row not found', 404)

  const { error } = await (supabase as any)
    .from('custom_table_rows')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('table_id', table.id)
    .eq('id', parsed.entityId)
  if (error) return err(error.message, 500)

  await enqueueDataTableEventWorkflows({
    supabase,
    tenantId,
    tableId: table.id,
    rowId: parsed.entityId,
    rowData: (existingRow.data as Record<string, any>) ?? {},
    eventType: 'deleted',
  })

  return new NextResponse(null, {
    status: 204,
    headers: {
      'OData-Version': '4.0',
    },
  })
}
