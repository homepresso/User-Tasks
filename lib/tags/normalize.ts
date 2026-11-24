/**
 * Tags as accepted by every object's create / update (data tables, reports,
 * business rules, email templates, form controls, apps, packages, …):
 * free text, tidied (trimmed, inner spaces collapsed, case kept), de-duplicated
 * case-insensitively (first spelling wins), at most TAG_LIST_MAX tags of at most
 * TAG_NAME_MAX characters. Pure: services call it and turn TagListError into a
 * validation error.
 */

import { cleanTagName, tagKey, TAG_NAME_MAX } from './palette'

export const TAG_LIST_MAX = 30

export class TagListError extends Error {}

/** A tidy tag list from whatever was sent (null / undefined → []). Throws TagListError on bad input. */
export function normalizeTagList(value: unknown, field = 'tags'): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new TagListError(`${field} must be an array of tag names`)
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (raw !== null && typeof raw !== 'string' && typeof raw !== 'number') throw new TagListError(`${field} must be an array of tag names`)
    const name = cleanTagName(raw)
    if (!name) continue
    if (name.length > TAG_NAME_MAX) throw new TagListError(`Tags must be at most ${TAG_NAME_MAX} characters: "${name.slice(0, 20)}…"`)
    const key = tagKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  if (out.length > TAG_LIST_MAX) throw new TagListError(`At most ${TAG_LIST_MAX} tags on one object`)
  return out
}

/** Tags from an imported / synced manifest: tidied, and never throws (bad entries dropped, list capped). */
export function manifestTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const name = cleanTagName(raw)
    const key = tagKey(name)
    if (!name || name.length > TAG_NAME_MAX || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= TAG_LIST_MAX) break
  }
  return out
}

/**
 * Spellings to match for a list `tag` filter. Array columns can't be matched
 * case-insensitively through PostgREST, so the filter matches the tidy
 * spelling as typed plus its usual case variants (lower, UPPER, Capitalised,
 * Title Case). Tags added through the app reuse the workspace's existing
 * spelling, so in practice one of these matches.
 */
export function tagFilterValues(tag: unknown): string[] {
  const name = cleanTagName(tag)
  if (!name) return []
  const lower = name.toLowerCase()
  const capitalised = lower.charAt(0).toUpperCase() + lower.slice(1)
  const title = lower.replace(/(^|[\s\-_/])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
  return [...new Set([name, lower, name.toUpperCase(), capitalised, title])]
}

/** Whether a row's tags include `tag` (case- and space-insensitive). */
export function hasTag(tags: readonly unknown[] | null | undefined, tag: unknown): boolean {
  const key = tagKey(tag)
  if (!key) return true
  return (tags ?? []).some((t) => tagKey(t) === key)
}
