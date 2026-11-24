/**
 * The `tags` column on data tables, reports, business rules, email templates,
 * form controls, apps and packages arrives with migration
 * 20270122150000_tags_everywhere. Code ships before the migration is applied,
 * so explicit selects that name `tags` retry without it (the rows read as
 * untagged) and writes that set tags answer "apply the migration".
 *
 * A failed SELECT / RETURNING clause fails the whole statement, so retrying a
 * write without `tags` in its RETURNING list never writes twice.
 */

import { normalizeTagList, TagListError } from '@/lib/tags/normalize'
import { ServiceError } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- query builder results */

export const TAGS_EVERYWHERE_MIGRATION = '20270122150000_tags_everywhere'

/** Postgres / PostgREST "column tags does not exist". */
export function isMissingTagsColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = String(error.message ?? '')
  if (!/\btags\b/.test(message)) return false
  return error.code === '42703' || error.code === 'PGRST204' || /does not exist|could not find/i.test(message)
}

export function tagsNotApplied(label: string): ServiceError {
  return new ServiceError('internal', `Tags on ${label} need database migration ${TAGS_EVERYWHERE_MIGRATION}; ask your administrator to apply it`, { status: 503 })
}

/** `columns, tags` */
export function withTags(columns: string): string {
  return /(^|,)\s*(tags|\*)\s*(,|$)/.test(columns) ? columns : `${columns}, tags`
}

/**
 * Run a query selecting `columns` plus `tags`; if the column isn't there yet,
 * run it again with `columns` only. `run` must build a fresh query each time.
 */
export async function selectWithTags<R = any>(columns: string, run: (columns: string) => PromiseLike<R>): Promise<R> {
  const first = await run(withTags(columns))
  if (!isMissingTagsColumn((first as { error?: any }).error)) return first
  return run(columns)
}

/** Validate tags sent to a create / update (ServiceError on bad input). */
export function validTags(value: unknown, field = 'tags'): string[] {
  try {
    return normalizeTagList(value, field)
  } catch (error) {
    if (error instanceof TagListError) throw ServiceError.validation(error.message)
    throw error
  }
}

/** Rows read before the migration have no `tags`: give them []. */
export function rowTags(row: { tags?: unknown } | null | undefined): string[] {
  return Array.isArray(row?.tags) ? (row!.tags as unknown[]).map(String) : []
}

/**
 * An insert / update whose values may carry `tags` and whose RETURNING list
 * should include them. Before the migration: an empty tag list is dropped
 * (it changes nothing) and the write runs without tags; real tags answer
 * "apply the migration". `run` must build a fresh query each time.
 */
export async function tagsSafeWrite<R = any>(
  label: string,
  values: Record<string, unknown>,
  columns: string,
  run: (values: Record<string, unknown>, columns: string) => PromiseLike<R>,
): Promise<R> {
  const first = await run(values, withTags(columns))
  if (!isMissingTagsColumn((first as { error?: any }).error)) return first
  if (Array.isArray(values.tags) && values.tags.length > 0) throw tagsNotApplied(label)
  const rest = { ...values }
  delete rest.tags
  return run(rest, columns)
}
