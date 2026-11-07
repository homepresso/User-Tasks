/**
 * Set Variable node config — one node can set several variables.
 *
 * Shapes (both valid; no migration):
 *   legacy: { name: "a", expression: "{{x}}" }
 *   multi:  { assignments: [{ name: "a", expression: "{{x}}" }, { name: "b", expression: "{{=a * 2}}" }] }
 *
 * `assignments` wins when it is a non-empty array; otherwise the legacy
 * `name` / `expression` pair is read as a single assignment. Readers go through
 * setVariableAssignments() so variables from every assignment are recognised.
 * Assignments run in order, so a later one can reference an earlier one.
 */

export interface SetVariableAssignment {
  name: string
  expression: unknown
}

type ConfigLike = Record<string, any> | null | undefined

function isObjectLike(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** The config uses the multi-assignment shape (a non-empty `assignments` list). */
export function usesSetVariableAssignments(config: ConfigLike): boolean {
  return Array.isArray(config?.assignments) && config!.assignments.length > 0
}

/**
 * Ordered assignments of a Set Variable config, whichever shape it uses.
 * Legacy configs give one assignment (none when the name is empty). Rows keep
 * their position (an unnamed row is returned with name ''), so callers that
 * list variables should skip empty names.
 */
export function setVariableAssignments(config: ConfigLike): SetVariableAssignment[] {
  if (usesSetVariableAssignments(config)) {
    return (config!.assignments as unknown[]).map((row) => {
      const a = isObjectLike(row) ? row : {}
      return {
        name: String(a.name ?? a.variable ?? '').trim(),
        expression: a.expression !== undefined ? a.expression : (a.value ?? ''),
      }
    })
  }
  const name = config?.name
  if (name === undefined || name === null || String(name) === '') return []
  return [{ name: String(name), expression: config?.expression }]
}

/** Variable names a Set Variable config writes, in order, without blanks or repeats. */
export function setVariableNames(config: ConfigLike): string[] {
  const out: string[] = []
  for (const { name } of setVariableAssignments(config)) {
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** Rows for the editor: always at least one (an empty row for a new node). */
export function setVariableEditorRows(config: ConfigLike): { name: string; expression: string }[] {
  const rows = setVariableAssignments(config).map((a) => ({
    name: a.name,
    expression: a.expression === undefined || a.expression === null
      ? ''
      : typeof a.expression === 'string' ? a.expression : JSON.stringify(a.expression),
  }))
  return rows.length > 0 ? rows : [{ name: '', expression: '' }]
}

/** Canvas summary: `a = {{x}}` for one, `Set 3 variables: a, b, c` for several. */
export function setVariableSummary(config: ConfigLike, maxNames = 3): string | null {
  const assignments = setVariableAssignments(config)
  if (!usesSetVariableAssignments(config)) {
    const only = assignments[0]
    return only ? `${only.name} = ${only.expression ?? '...'}` : null
  }
  const named = assignments.filter((a) => a.name)
  if (named.length === 0) return null
  if (assignments.length === 1) {
    const only = named[0]
    const expression = only.expression === '' || only.expression === undefined || only.expression === null ? '...' : only.expression
    return `${only.name} = ${typeof expression === 'string' ? expression : JSON.stringify(expression)}`
  }
  const names = named.slice(0, maxNames).map((a) => a.name)
  const more = named.length - names.length
  return `Set ${assignments.length} variables: ${names.join(', ')}${more > 0 ? ` +${more} more` : ''}`
}

export interface SetVariableRowIssue {
  /** Row index (0-based). */
  index: number
  field: 'name' | 'expression'
  message: string
}

/** Unbalanced `{{` / `}}` — an expression the resolver would leave half-resolved. */
export function expressionSyntaxError(expression: unknown): string | null {
  if (typeof expression !== 'string' || (!expression.includes('{{') && !expression.includes('}}'))) return null
  let depth = 0
  for (let i = 0; i < expression.length - 1; i++) {
    const pair = expression.slice(i, i + 2)
    if (pair === '{{') { depth++; i++ }
    else if (pair === '}}') {
      if (depth === 0) return 'has "}}" without a matching "{{"'
      depth--; i++
    }
  }
  if (depth > 0) return 'has "{{" without a matching "}}"'
  return null
}

/**
 * Per-row problems of a multi-assignment config: missing name, a name used
 * twice, an unbalanced expression. Legacy single configs are not checked here
 * (validateNode keeps their single "Variable name required" check).
 */
export function setVariableRowIssues(config: ConfigLike): SetVariableRowIssue[] {
  if (!usesSetVariableAssignments(config)) return []
  const issues: SetVariableRowIssue[] = []
  const firstIndex = new Map<string, number>()
  setVariableAssignments(config).forEach((a, index) => {
    if (!a.name) issues.push({ index, field: 'name', message: 'Variable name required' })
    else if (/[\s{}]/.test(a.name)) issues.push({ index, field: 'name', message: `"${a.name}" can't contain spaces or braces` })
    else if (firstIndex.has(a.name)) issues.push({ index, field: 'name', message: `"${a.name}" is already set in row ${firstIndex.get(a.name)! + 1}` })
    else firstIndex.set(a.name, index)
    const syntax = expressionSyntaxError(a.expression)
    if (syntax) issues.push({ index, field: 'expression', message: `Value ${syntax}` })
  })
  return issues
}

/** Node-level validation messages (one per row issue, naming the row and variable). */
export function setVariableValidationErrors(config: ConfigLike): string[] {
  if (!usesSetVariableAssignments(config)) return config?.name ? [] : ['Variable name required']
  const assignments = setVariableAssignments(config)
  return setVariableRowIssues(config).map((issue) => {
    const name = assignments[issue.index]?.name
    return `Row ${issue.index + 1}${name && issue.field === 'expression' ? ` (${name})` : ''}: ${issue.message}`
  })
}
