import { toKeySlug } from '@/lib/utils/slug'

type TableColumn = {
  id?: string
  key?: string
  name?: string
  label?: string
  type?: string
}

type TableRow = {
  id: string
  data: Record<string, any>
  created_at?: string | null
  updated_at?: string | null
}

type GenericServiceEntitySet = {
  name: string
  title?: string
  url?: string
  kind?: string
  metadata?: Record<string, any>
}

type GenericMetadataEntitySet = {
  entitySetName: string
  entityTypeName: string
  keyName: string
  properties: Array<{
    name: string
    type: string
    nullable?: boolean
  }>
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sanitizeIdentifier(value: string, fallback: string) {
  const raw = value.replace(/[^A-Za-z0-9_]/g, '_')
  const trimmed = raw.replace(/^_+|_+$/g, '')
  const candidate = trimmed || fallback
  return /^[A-Za-z_]/.test(candidate) ? candidate : `t_${candidate}`
}

export function normalizeTableColumns(columns: unknown): TableColumn[] {
  if (!Array.isArray(columns)) return []
  return columns
    .filter((column): column is TableColumn => typeof column === 'object' && column !== null)
    .map((column) => ({
      id: column.id,
      key: column.key ?? (column.name ? toKeySlug(String(column.name)) : undefined),
      name: column.name ?? column.label ?? column.key,
      label: column.label ?? column.name ?? column.key,
      type: column.type ?? 'text',
    }))
    .filter((column) => column.key)
}

function mapColumnTypeToEdm(type: string | undefined) {
  switch (type) {
    case 'number':
      return 'Edm.Double'
    case 'boolean':
      return 'Edm.Boolean'
    case 'date':
      return 'Edm.Date'
    default:
      return 'Edm.String'
  }
}

function tryNumber(value: any) {
  if (value == null || String(value).trim() === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function tryDate(value: any) {
  if (value == null || String(value).trim() === '') return null
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

export function getODataCollectionName(table: { slug?: string | null; name?: string | null; id: string }) {
  return sanitizeIdentifier(table.slug || table.name || table.id, 'table')
}

export function getODataEntityTypeName(table: { slug?: string | null; name?: string | null; id: string }) {
  return sanitizeIdentifier((table.slug || table.name || table.id).replace(/-/g, '_'), 'Entity')
}

export function buildServiceDocument(params: {
  baseUrl: string
  tables: Array<{ id: string; name: string; slug?: string | null }>
  extras?: GenericServiceEntitySet[]
}) {
  return {
    '@odata.context': `${params.baseUrl}/$metadata`,
    value: [
      ...params.tables.map((table) => ({
        name: getODataCollectionName(table),
        kind: 'EntitySet',
        url: getODataCollectionName(table),
        title: table.name,
        table_id: table.id,
      })),
      ...((params.extras ?? []).map((extra) => ({
        name: extra.name,
        kind: extra.kind ?? 'EntitySet',
        url: extra.url ?? extra.name,
        title: extra.title ?? extra.name,
        ...(extra.metadata ?? {}),
      }))),
    ],
  }
}

export function buildMetadataXml(params: {
  namespace: string
  baseUrl: string
  tables: Array<{ id: string; name: string; slug?: string | null; columns?: unknown }>
  extras?: GenericMetadataEntitySet[]
}) {
  const entityTypes = params.tables.map((table) => {
    const entityTypeName = getODataEntityTypeName(table)
    const properties = normalizeTableColumns(table.columns).map((column) => {
      const propertyName = sanitizeIdentifier(String(column.key), 'field')
      return `      <Property Name="${escapeXml(propertyName)}" Type="${mapColumnTypeToEdm(column.type)}" Nullable="true" />`
    })

    return [
      `    <EntityType Name="${escapeXml(entityTypeName)}">`,
      '      <Key>',
      '        <PropertyRef Name="RowId" />',
      '      </Key>',
      '      <Property Name="RowId" Type="Edm.String" Nullable="false" />',
      '      <Property Name="CreatedAt" Type="Edm.DateTimeOffset" Nullable="true" />',
      '      <Property Name="UpdatedAt" Type="Edm.DateTimeOffset" Nullable="true" />',
      ...properties,
      '    </EntityType>',
    ].join('\n')
  })

  const entitySets = params.tables.map((table) => {
    const collectionName = getODataCollectionName(table)
    const entityTypeName = getODataEntityTypeName(table)
    return `      <EntitySet Name="${escapeXml(collectionName)}" EntityType="${escapeXml(`${params.namespace}.${entityTypeName}`)}" />`
  })

  const extraEntityTypes = (params.extras ?? []).map((entity) => [
    `    <EntityType Name="${escapeXml(entity.entityTypeName)}">`,
    '      <Key>',
    `        <PropertyRef Name="${escapeXml(entity.keyName)}" />`,
    '      </Key>',
    ...entity.properties.map((property) =>
      `      <Property Name="${escapeXml(property.name)}" Type="${escapeXml(property.type)}" Nullable="${property.nullable === false ? 'false' : 'true'}" />`,
    ),
    '    </EntityType>',
  ].join('\n'))

  const extraEntitySets = (params.extras ?? []).map((entity) =>
    `      <EntitySet Name="${escapeXml(entity.entitySetName)}" EntityType="${escapeXml(`${params.namespace}.${entity.entityTypeName}`)}" />`,
  )

  return `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="${escapeXml(params.namespace)}" xmlns="http://docs.oasis-open.org/odata/ns/edm">
${entityTypes.join('\n')}
${extraEntityTypes.join('\n')}
      <EntityContainer Name="Container">
${entitySets.join('\n')}
${extraEntitySets.join('\n')}
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`
}

export function buildEntity(params: {
  baseUrl: string
  table: { id: string; slug?: string | null; name?: string | null; columns?: unknown }
  row: TableRow
}) {
  const collectionName = getODataCollectionName(params.table)
  const entity: Record<string, any> = {
    '@odata.id': `${params.baseUrl}/${collectionName}('${encodeURIComponent(params.row.id)}')`,
    RowId: params.row.id,
    CreatedAt: params.row.created_at ?? null,
    UpdatedAt: params.row.updated_at ?? null,
  }

  for (const column of normalizeTableColumns(params.table.columns)) {
    const propertyName = sanitizeIdentifier(String(column.key), 'field')
    entity[propertyName] = params.row.data?.[String(column.key)] ?? null
  }

  return entity
}

export function buildCollectionResponse(params: {
  baseUrl: string
  table: { id: string; slug?: string | null; name?: string | null; columns?: unknown }
  rows: TableRow[]
  count?: number | null
}) {
  const collectionName = getODataCollectionName(params.table)
  return {
    '@odata.context': `${params.baseUrl}/$metadata#${collectionName}`,
    ...(typeof params.count === 'number' ? { '@odata.count': params.count } : {}),
    value: params.rows.map((row) => buildEntity({ baseUrl: params.baseUrl, table: params.table, row })),
  }
}

function getEntityFieldValue(entity: Record<string, any>, field: string) {
  return entity[field]
}

function compareValues(leftRaw: any, rightRaw: any) {
  const leftNumber = tryNumber(leftRaw)
  const rightNumber = tryNumber(rightRaw)
  if (leftNumber != null && rightNumber != null) return leftNumber - rightNumber

  const leftDate = tryDate(leftRaw)
  const rightDate = tryDate(rightRaw)
  if (leftDate != null && rightDate != null) return leftDate - rightDate

  return String(leftRaw ?? '').localeCompare(String(rightRaw ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function parseLiteral(raw: string) {
  const trimmed = raw.trim()
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  const num = tryNumber(trimmed)
  if (num != null) return num
  return trimmed
}

function splitFunctionArgs(raw: string) {
  const args: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (char === "'" && raw[i - 1] !== '\\') {
      inQuote = !inQuote
      current += char
      continue
    }
    if (char === ',' && !inQuote) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) args.push(current.trim())
  return args
}

function resolveValueExpression(entity: Record<string, any>, expression: string): any {
  const trimmed = expression.trim()
  const stringFnMatch = trimmed.match(/^(tolower|toupper|trim)\((.+)\)$/i)
  if (stringFnMatch) {
    const [, fnName, innerExpression] = stringFnMatch
    const inner = resolveValueExpression(entity, innerExpression)
    const text = String(inner ?? '')
    switch (fnName.toLowerCase()) {
      case 'tolower':
        return text.toLowerCase()
      case 'toupper':
        return text.toUpperCase()
      case 'trim':
        return text.trim()
      default:
        return text
    }
  }

  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return getEntityFieldValue(entity, trimmed)
  }

  return parseLiteral(trimmed)
}

function evaluateFunctionClause(entity: Record<string, any>, clause: string) {
  const fnMatch = clause.trim().match(/^(contains|startswith|endswith)\((.+)\)$/i)
  if (!fnMatch) return null

  const [, fnName, rawArgs] = fnMatch
  const args = splitFunctionArgs(rawArgs)
  if (args.length !== 2) return true

  const left = String(resolveValueExpression(entity, args[0]) ?? '')
  const right = String(resolveValueExpression(entity, args[1]) ?? '')
  const normalizedLeft = left.toLowerCase()
  const normalizedRight = right.toLowerCase()

  switch (fnName.toLowerCase()) {
    case 'contains':
      return normalizedLeft.includes(normalizedRight)
    case 'startswith':
      return normalizedLeft.startsWith(normalizedRight)
    case 'endswith':
      return normalizedLeft.endsWith(normalizedRight)
    default:
      return true
  }
}

function evaluateClause(entity: Record<string, any>, clause: string) {
  const functionResult = evaluateFunctionClause(entity, clause)
  if (functionResult != null) return functionResult

  const match = clause.trim().match(/^(.+?)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i)
  if (!match) return true

  const [, leftExpression, operator, rawValue] = match
  const left = resolveValueExpression(entity, leftExpression)
  const right = resolveValueExpression(entity, rawValue)
  const cmp = compareValues(left, right)

  switch (operator.toLowerCase()) {
    case 'eq':
      return cmp === 0
    case 'ne':
      return cmp !== 0
    case 'gt':
      return cmp > 0
    case 'ge':
      return cmp >= 0
    case 'lt':
      return cmp < 0
    case 'le':
      return cmp <= 0
    default:
      return true
  }
}

export function applyODataFilter(entities: Record<string, any>[], filter: string | null) {
  if (!filter?.trim()) return entities

  const orGroups = filter.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean)
  return entities.filter((entity) =>
    orGroups.some((group) => {
      const andClauses = group.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean)
      return andClauses.every((clause) => evaluateClause(entity, clause))
    }),
  )
}

export function applyODataOrderBy(entities: Record<string, any>[], orderBy: string | null) {
  if (!orderBy?.trim()) return entities
  const orderings = orderBy.split(',').map((part) => {
    const [field, dir] = part.trim().split(/\s+/)
    return { field, dir: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' as 'asc' | 'desc' }
  }).filter((item) => item.field)

  if (!orderings.length) return entities

  return [...entities].sort((a, b) => {
    for (const ordering of orderings) {
      const cmp = compareValues(a[ordering.field], b[ordering.field])
      if (cmp !== 0) return ordering.dir === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

export function applyODataSelect(entities: Record<string, any>[], select: string | null) {
  if (!select?.trim()) return entities
  const requested = new Set(select.split(',').map((part) => part.trim()).filter(Boolean))
  requested.add('RowId')

  return entities.map((entity) => {
    const next: Record<string, any> = {}
    for (const [key, value] of Object.entries(entity)) {
      if (key.startsWith('@odata.') || requested.has(key)) next[key] = value
    }
    return next
  })
}

export function parseEntityRequestSegment(segment: string) {
  const match = segment.match(/^([^()]+)\((.+)\)$/)
  if (!match) return { collectionName: segment, entityId: null as string | null }
  const [, collectionName, rawKey] = match
  const trimmed = rawKey.trim().replace(/^'|'$/g, '').replace(/^"|"$/g, '')
  return {
    collectionName,
    entityId: decodeURIComponent(trimmed),
  }
}

export function buildCreateOrUpdatePayload(params: {
  body: Record<string, any>
  table: { columns?: unknown }
  existing?: Record<string, any> | null
}) {
  const payload = { ...(params.existing ?? {}) }

  for (const column of normalizeTableColumns(params.table.columns)) {
    const propertyName = sanitizeIdentifier(String(column.key), 'field')
    if (propertyName in params.body) {
      payload[String(column.key)] = params.body[propertyName]
    }
  }

  return payload
}

export function buildAutoPopulatedRowData(params: {
  existingRows?: Array<{ data?: Record<string, any> | null }>
  table: { columns?: unknown }
  payload: Record<string, any>
}) {
  const next = { ...params.payload }
  const columns = normalizeTableColumns(params.table.columns)

  const idColumn = columns.find((column) => String(column.key) === 'id' && column.type === 'number')
  if (idColumn && (next.id == null || next.id === '')) {
    const maxId = (params.existingRows ?? []).reduce((max, row) => {
      const current = Number(row.data?.id ?? 0)
      return Number.isFinite(current) ? Math.max(max, current) : max
    }, 0)
    next.id = maxId + 1
  }

  const dateColumn = columns.find((column) => String(column.key) === 'date_created')
  if (dateColumn && (next[String(dateColumn.key)] == null || next[String(dateColumn.key)] === '')) {
    next[String(dateColumn.key)] = new Date().toISOString().split('T')[0]
  }

  return next
}

export function buildRowContext(baseUrl: string, collectionName: string, entityId: string) {
  return `${baseUrl}/$metadata#${collectionName}/$entity`
}
