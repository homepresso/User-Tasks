import type { FilterValues } from '@/lib/apps/widgets'
import {
  INSTANCE_DATASET_COLUMNS, instanceDatasetParamsSchema, isInstanceDataset, type InstanceColumn, type InstanceDataset,
} from '@/lib/instance-admin/schema'
import type { ServiceContext } from '../context'
import { readInstanceDataset, type InstancePage } from './index'

/**
 * The app builder's built-in "UserTasks instance" source for lists (data
 * grid and card view with source 'instance'). Each call checks the instance
 * admin again (readInstanceDataset → requireInstanceAdmin): a viewer who is
 * not one gets 403 with ACCESS_MESSAGE, which the widget shows. Paging,
 * search, filters and sort run on the server.
 */

type ParamValue = string | { filter: string }

/** Instance params of a widget (literal, {filter:<id>}, or "{{filter:<id>}}" / "{{param.x}}" text), resolved against the page's filters. */
export function resolveInstanceParams(map: Record<string, ParamValue> | null | undefined, filters: FilterValues): Record<string, string> {
  const out: Record<string, string> = {}
  const lookup = (id: string) => {
    const v = filters[id]
    return typeof v === 'string' ? v : ''
  }
  for (const [name, raw] of Object.entries(map ?? {})) {
    let value = ''
    if (raw && typeof raw === 'object' && typeof raw.filter === 'string') value = lookup(raw.filter)
    else if (typeof raw === 'string') {
      value = raw.replace(/\{\{\s*(?:filter:)?((?:param|var|sys)\.[A-Za-z0-9_.]{1,36}|[a-z][a-z0-9_]{0,39})\s*\}\}/g, (_m, id: string) => lookup(id))
    }
    value = value.trim().slice(0, 200)
    if (value) out[name] = value
  }
  return out
}

/** Grid / card column type of a dataset column (bytes and currency show as numbers; the widget's formats style them). */
export function widgetColumnType(col: InstanceColumn): string {
  if (col.type === 'currency') return 'number'
  if (col.type === 'bytes') return 'text'
  return col.type
}

const MB = 1_048_576
/** Bytes as a readable size (grids and cards; the API returns raw bytes). */
export function readableBytes(v: unknown): string | null {
  const n = Number(v)
  if (v === null || v === undefined || !Number.isFinite(n)) return null
  if (n < 1024) return `${n} B`
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`
  if (n < MB * 1024) return `${(n / MB).toFixed(1)} MB`
  return `${(n / MB / 1024).toFixed(2)} GB`
}

export interface InstanceListRequest {
  dataset: unknown
  params: Record<string, ParamValue> | null | undefined
  filters: FilterValues
  page: number
  size: number
  q?: string
  sort?: string | null
  dir?: 'asc' | 'desc' | null
}

/** A page of a dataset for a widget (rows keep the dataset's declared columns only). */
export async function instanceList(ctx: ServiceContext, req: InstanceListRequest): Promise<{ dataset: InstanceDataset; page: InstancePage; columns: readonly InstanceColumn[] } | null> {
  if (!isInstanceDataset(req.dataset)) return null
  const resolved: Record<string, unknown> = resolveInstanceParams(req.params, req.filters)
  if (req.q) resolved.q = req.q
  const columns = INSTANCE_DATASET_COLUMNS[req.dataset]
  if (req.sort && columns.some((c) => c.key === req.sort)) { resolved.sort = req.sort; resolved.dir = req.dir ?? 'asc' }
  resolved.limit = req.size
  resolved.offset = req.page * req.size
  // Unknown or malformed values (e.g. an empty filter) are dropped rather than failing the widget.
  const safe = instanceDatasetParamsSchema.safeParse(resolved)
  const params = safe.success ? safe.data : Object.fromEntries(Object.entries(resolved).filter(([k, v]) => instanceDatasetParamsSchema.shape[k as keyof typeof instanceDatasetParamsSchema.shape]?.safeParse(v).success))
  const page = await readInstanceDataset(ctx, req.dataset, params, { via: 'app', refusal: 'forbidden' })
  return { dataset: req.dataset, page, columns }
}

/**
 * A row id for a dataset row: its id, else what it is about — all of it (an
 * asset row is one KIND of one workspace: every row of a workspace's Assets
 * shares the workspace id, and those duplicate keys made the grid drop and
 * mix up rows and cells).
 */
export function instanceRowId(row: Record<string, unknown>, index: number): string {
  if (row.id !== null && row.id !== undefined && row.id !== '') return String(row.id).slice(0, 120)
  const parts = [row.workspace_id, row.user_id, row.kind, row.queue, row.day].filter((v) => v !== null && v !== undefined && v !== '').map(String)
  return (parts.length ? parts.join(':') : `row-${index}`).slice(0, 120)
}

/** A dataset row for display: bytes as readable sizes. */
export function displayRow(columns: readonly InstanceColumn[], row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const c of columns) if (c.type === 'bytes') out[c.key] = readableBytes(row[c.key])
  return out
}
