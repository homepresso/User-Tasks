'use client'

export type LookupFilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'not_empty'

export interface LookupFilter {
  id: string
  column: string
  operator: LookupFilterOperator
  value?: string
}

export interface LookupConfig {
  sourceTableId?: string
  sourceTableName?: string
  sourceColumn?: string
  filters?: LookupFilter[]
  distinct?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface DataColumn {
  id: string
  /** Stable row-data key. Backfilled from a slug of the name for legacy columns. */
  key?: string
  name: string
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'file' | 'longtext' | 'lookup'
  options?: string[]
  required?: boolean
  lookup?: LookupConfig
}

export interface LookupOption {
  value: string
  label: string
}
