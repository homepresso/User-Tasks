/**
 * SQL text with bound parameters. Values only ever travel as parameters
 * (`$n`, sent untyped so Postgres infers them from context exactly as it
 * does for PostgREST's "unknown" literals); identifiers are double-quoted
 * with quotes doubled, after validation against the schema cache.
 */
export class SqlBuilder {
  readonly params: unknown[] = []

  /** Placeholder for an untyped (unknown) literal. */
  param(value: unknown): string {
    this.params.push(value)
    return `$${this.params.length}`
  }
}

export function ident(name: string): string {
  return `"${name.replace(/\0/g, '').replace(/"/g, '""')}"`
}

/** schema-qualified identifier; empty schema renders the bare name. */
export function qident(schema: string, name: string): string {
  return schema ? `${ident(schema)}.${ident(name)}` : ident(name)
}

/**
 * PostgreSQL array literal for `= ANY($n)`, quoting every element
 * (pgBuildArrayLiteral in PostgREST).
 */
export function arrayLiteral(values: string[]): string {
  return `{${values
    .map((v) => `"${v.replace(/\0/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`
}

/** Casts are emitted unquoted (like PostgREST) and so must be plain type names. */
const CAST = /^[a-z_][a-z0-9_ ]*(\[\])*$/i

export function isSafeCast(cast: string): boolean {
  return CAST.test(cast.trim())
}
