/**
 * Structured outputs of an agent run (client-safe, pure).
 *
 * An agent declares output variables (name, type, description, required,
 * enum). The model is asked to end its final message with a fenced JSON
 * block holding exactly those keys (outputInstruction). parseStructuredOutputs
 * finds the block; validateOutputs checks and coerces each value against its
 * declared type ("3" → 3 for a number, "true" → true, a JSON string → the
 * array / object). When values are missing or invalid the executor asks the
 * model once to repair its answer (repairMessage); a strict agent then fails
 * the run instead of completing with nulls.
 */

export interface OutputVariableSpec {
  name: string
  type?: string
  description?: string
  required?: boolean
  enum?: string[]
}

export interface OutputValidation {
  outputs: Record<string, unknown>
  /** Human-readable problems (missing / invalid keys); empty when valid. */
  errors: string[]
  /** No JSON block could be found at all. */
  noJson: boolean
}

const TYPE_HINT: Record<string, string> = {
  string: 'string', number: 'number', integer: 'integer', boolean: 'true/false',
  array: 'JSON array', object: 'JSON object',
}

/** System-prompt addition asking for the final JSON block. */
export function outputInstruction(vars: OutputVariableSpec[]): string {
  if (vars.length === 0) return ''
  const lines = vars.map((v) => {
    const type = TYPE_HINT[String(v.type ?? 'string')] ?? 'string'
    const parts = [`"${v.name}" (${type}${v.required ? ', required' : ''})`]
    if (v.enum?.length) parts.push(`one of ${v.enum.map((e) => JSON.stringify(e)).join(', ')}`)
    if (v.description) parts.push(v.description)
    return `- ${parts.join(' — ')}`
  })
  return [
    '',
    'When you have finished, end your final message with a fenced code block labelled json containing EXACTLY these keys (use null only for an optional value you cannot determine):',
    ...lines,
    'Example:',
    '```json',
    `{ ${vars.map((v) => `"${v.name}": ...`).join(', ')} }`,
    '```',
  ].join('\n')
}

/** Find the last fenced JSON object (or a trailing bare object) in the model's text. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (raw: string): Record<string, unknown> | null => {
    try {
      const obj = JSON.parse(raw)
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
    } catch { return null }
  }
  const source = String(text ?? '')
  const fences = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (let i = fences.length - 1; i >= 0; i--) {
    const parsed = tryParse(fences[i][1].trim())
    if (parsed) return parsed
  }
  const brace = source.match(/\{[\s\S]*\}\s*$/)
  if (brace) {
    const parsed = tryParse(brace[0])
    if (parsed) return parsed
  }
  // Whole message is JSON (some providers in JSON mode).
  return tryParse(source.trim())
}

function coerce(value: unknown, type: string): { ok: true; value: unknown } | { ok: false } {
  switch (type) {
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value }
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.replace(/,/g, '')))) return { ok: true, value: Number(value.replace(/,/g, '')) }
      return { ok: false }
    }
    case 'integer': {
      const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
      return typeof n === 'number' && Number.isInteger(n) ? { ok: true, value: n } : { ok: false }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value }
      if (typeof value === 'string' && /^(true|false|yes|no)$/i.test(value.trim())) return { ok: true, value: /^(true|yes)$/i.test(value.trim()) }
      return { ok: false }
    }
    case 'array': {
      if (Array.isArray(value)) return { ok: true, value }
      if (typeof value === 'string') { try { const v = JSON.parse(value); if (Array.isArray(v)) return { ok: true, value: v } } catch { /* fallthrough */ } }
      return { ok: false }
    }
    case 'object': case 'json': {
      if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value }
      if (typeof value === 'string') { try { const v = JSON.parse(value); if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v } } catch { /* fallthrough */ } }
      return { ok: false }
    }
    case 'any':
      return { ok: true, value }
    default: {
      if (typeof value === 'string') return { ok: true, value }
      if (typeof value === 'number' || typeof value === 'boolean') return { ok: true, value: String(value) }
      return { ok: false }
    }
  }
}

/** Validate / coerce the declared outputs from the model's final text. */
export function validateOutputs(text: string, vars: OutputVariableSpec[]): OutputValidation {
  const source = extractJsonObject(text)
  if (!source) {
    return {
      outputs: Object.fromEntries(vars.map((v) => [v.name, null])),
      errors: ['No JSON output block was found'],
      noJson: true,
    }
  }
  const outputs: Record<string, unknown> = {}
  const errors: string[] = []
  for (const v of vars) {
    // Undeclared type: any JSON value (normalised agent configs always declare one).
    const type = String(v.type ?? 'any')
    const raw = source[v.name]
    if (raw === undefined || raw === null || raw === '') {
      outputs[v.name] = null
      if (v.required) errors.push(`"${v.name}" is required`)
      else if (raw === undefined) errors.push(`"${v.name}" is missing`)
      continue
    }
    const c = coerce(raw, type)
    if (!c.ok) {
      outputs[v.name] = null
      errors.push(`"${v.name}" must be ${TYPE_HINT[type] ?? type}`)
      continue
    }
    if (v.enum?.length && !v.enum.includes(String(c.value))) {
      outputs[v.name] = null
      errors.push(`"${v.name}" must be one of ${v.enum.join(', ')}`)
      continue
    }
    outputs[v.name] = c.value
  }
  return { outputs, errors, noJson: false }
}

/** Errors that should trigger a repair attempt / strict failure (optional keys may be absent). */
export function blockingErrors(validation: OutputValidation, vars: OutputVariableSpec[]): string[] {
  if (validation.noJson) return validation.errors
  const optionalMissing = new Set(vars.filter((v) => !v.required).map((v) => `"${v.name}" is missing`))
  return validation.errors.filter((e) => !optionalMissing.has(e))
}

/** The user turn asking the model to fix its final JSON block. */
export function repairMessage(errors: string[], vars: OutputVariableSpec[]): string {
  return [
    'Your final answer did not include a valid JSON output block:',
    ...errors.map((e) => `- ${e}`),
    `Reply again with your final answer, ending with a fenced json block containing exactly these keys: ${vars.map((v) => v.name).join(', ')}.`,
  ].join('\n')
}
