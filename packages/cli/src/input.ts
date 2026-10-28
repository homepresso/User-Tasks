/** Request input helpers: body files, `--set` assignments and `-q` query pairs. */

import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { CliUsageError } from './exit-codes'

/** Parse JSON, falling back to YAML (YAML files may use either). */
export function parseDocument(text: string, source: string): unknown {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    try {
      return YAML.parse(text)
    } catch (error) {
      throw new CliUsageError(`${source} is neither valid JSON nor YAML: ${(error as Error).message}`)
    }
  }
}

/** Read a request body from a file path, or stdin when `path` is `-`. */
export async function readBodyFile(path: string, readStdin: () => Promise<string>): Promise<unknown> {
  if (path === '-') return parseDocument(await readStdin(), 'stdin')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new CliUsageError(`Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
  }
  return parseDocument(text, path)
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let node = target
  for (const key of path.slice(0, -1)) {
    const next = node[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[path[path.length - 1]] = value
}

async function readValueFile(path: string, assignment: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    throw new CliUsageError(`Cannot read ${path} for --set ${assignment}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
  }
}

/**
 * Apply `--set` assignments onto a body (httpie-style):
 *   key=value     string value
 *   key:=json     raw JSON value (numbers, booleans, null, arrays, objects)
 *   key=@path     the file's text as a string (e.g. html_body=@template.html)
 *   key:=@path    the file parsed as JSON or YAML (e.g. manifest:=@manifest.json)
 * A leading `\@` keeps a literal `@` (`handle=\@me`). Dotted keys set nested
 * fields: `config.limit:=10`.
 */
export async function applyAssignments(
  body: unknown,
  assignments: readonly string[],
  readText: (path: string, assignment: string) => Promise<string> = readValueFile,
): Promise<unknown> {
  if (!assignments.length) return body
  if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
    throw new CliUsageError('--set needs the request body (from -f) to be a JSON object')
  }
  const result: Record<string, unknown> = structuredClone((body as Record<string, unknown> | undefined) ?? {})
  for (const assignment of assignments) {
    const match = /^([^=:]+?)(:?=)(.*)$/s.exec(assignment)
    if (!match || !match[1].trim()) throw new CliUsageError(`Invalid --set "${assignment}" (expected key=value, key:=json or key=@file)`)
    const [, rawKey, operator, rawValue] = match
    const path = rawKey.trim().split('.')
    if (path.some((part) => !part)) throw new CliUsageError(`Invalid key in --set "${assignment}"`)

    let value: unknown
    if (rawValue.startsWith('@') && rawValue.length > 1) {
      const file = rawValue.slice(1)
      const text = await readText(file, assignment)
      value = operator === ':=' ? parseDocument(text, file) : text
    } else {
      const literal = rawValue.startsWith('\\@') ? rawValue.slice(1) : rawValue
      value = literal
      if (operator === ':=') {
        try {
          value = JSON.parse(literal)
        } catch {
          throw new CliUsageError(`Invalid JSON in --set ${rawKey}:=${rawValue}`)
        }
      }
    }
    setPath(result, path, value)
  }
  return result
}

/** `-q key=value` pairs → query object (repeated keys become arrays). */
export function parseQueryPairs(pairs: readonly string[]): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}
  for (const pair of pairs) {
    const index = pair.indexOf('=')
    if (index <= 0) throw new CliUsageError(`Invalid query parameter "${pair}" (expected key=value)`)
    const key = pair.slice(0, index)
    const value = pair.slice(index + 1)
    const existing = query[key]
    query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value]
  }
  return query
}

/** Body from `-f` and/or `--set`; undefined when neither was given. */
export async function buildBody(file: string | undefined, assignments: readonly string[], readStdin: () => Promise<string>): Promise<unknown> {
  const base = file ? await readBodyFile(file, readStdin) : undefined
  return applyAssignments(base, assignments)
}

export const collect = (value: string, previous: string[] = []) => [...previous, value]
