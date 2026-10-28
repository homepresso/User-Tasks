import type { ReportSourceInput } from '@/lib/report-sources'

export type InputJsonValidation = {
  parsed?: Record<string, any>
  error?: string
  keyCount: number
  missingRequired?: string[]
}

export function normalizeReferenceInputOptions(input: any): Array<{ label: string; value: string }> {
  if (!Array.isArray(input?.options) || input.options.length === 0) return []

  return (input.options as Array<string | { label?: string; value?: string }>)
    .map((option): { label: string; value: string } | null => {
      if (typeof option === 'string') {
        return option ? { label: option, value: option } : null
      }
      const value = String(option?.value ?? option?.label ?? '').trim()
      if (!value) return null
      return {
        label: String(option?.label ?? value).trim() || value,
        value,
      }
    })
    .filter((option): option is { label: string; value: string } => Boolean(option))
}

export function validateReferenceInputsJson(raw: string): InputJsonValidation {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { parsed: undefined, keyCount: 0 }
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed == null || Array.isArray(parsed) || typeof parsed !== 'object') {
      return {
        error: 'Inputs must be a JSON object like {"limit":100}.',
        keyCount: 0,
      }
    }
    return {
      parsed,
      keyCount: Object.keys(parsed).length,
    }
  } catch {
    return {
      error: 'Inputs must be valid JSON.',
      keyCount: 0,
    }
  }
}

export function isMissingRequiredReferenceInputValue(value: any) {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function applyRequiredReferenceInputValidation(
  validation: InputJsonValidation,
  inputs?: ReportSourceInput[],
): InputJsonValidation {
  if (validation.error || !validation.parsed || !inputs?.length) {
    return {
      ...validation,
      missingRequired: [],
    }
  }

  const missingRequired = inputs
    .filter((input) => input.required)
    .filter((input) => isMissingRequiredReferenceInputValue(validation.parsed?.[input.name]))
    .map((input) => input.label || input.name)

  if (missingRequired.length === 0) {
    return {
      ...validation,
      missingRequired,
    }
  }

  return {
    ...validation,
    missingRequired,
    error: `Missing required inputs: ${missingRequired.join(', ')}`,
  }
}

export function getSuggestedReferenceInputValue(input: ReportSourceInput) {
  if (input.defaultValue !== undefined) return input.defaultValue
  const options = normalizeReferenceInputOptions(input)
  if (options.length > 0) return options[0]?.value ?? ''

  switch (String(input.type ?? '').toLowerCase()) {
    case 'number':
    case 'integer':
    case 'float':
    case 'decimal':
      return 0
    case 'boolean':
    case 'bool':
      return false
    case 'date':
    case 'datetime':
    case 'timestamp':
      return ''
    case 'array':
      return []
    case 'object':
    case 'json':
      return {}
    default:
      return input.placeholder || ''
  }
}

export function buildReferenceInputTemplate(inputs?: ReportSourceInput[]) {
  if (!inputs?.length) return '{}'

  const payload = Object.fromEntries(
    inputs.map((input) => [input.name, getSuggestedReferenceInputValue(input)]),
  )
  return JSON.stringify(payload, null, 2)
}

export function normalizeReferenceInputValueForSubmission(input: ReportSourceInput, value: any) {
  const type = String(input.type ?? '').toLowerCase()

  if (value === undefined || value === null) return undefined

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined

    if (type === 'date') {
      return trimmed
    }
    if (type === 'datetime' || type === 'timestamp') {
      const normalized = trimmed.length === 16 ? `${trimmed}:00` : trimmed
      const parsed = new Date(normalized)
      return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString()
    }
    return trimmed
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value : undefined
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0 ? value : undefined
  }

  return value
}

export function normalizeReferenceInputPayload(
  parsed: Record<string, any> | undefined,
  inputs?: ReportSourceInput[],
) {
  if (!parsed) return undefined
  if (!inputs?.length) return parsed

  const normalizedEntries = inputs.flatMap((input) => {
    const normalizedValue = normalizeReferenceInputValueForSubmission(input, parsed[input.name])
    return normalizedValue === undefined ? [] : [[input.name, normalizedValue] as const]
  })

  if (normalizedEntries.length === 0) return undefined
  return Object.fromEntries(normalizedEntries)
}

// ─── Serialising input values into a request ───

function isFileRef(value: any): boolean {
  return value != null && typeof value === 'object' && !Array.isArray(value) && (value._file === true || typeof value.url === 'string')
}

/**
 * A reference input value as request text (query, header, path, text body):
 * a file reference → its URL, an object / array → JSON, null → ''.
 * (String() turned objects into "[object Object]".)
 */
export function referenceInputText(value: any): string {
  if (value == null) return ''
  if (isFileRef(value)) return String(value.url ?? value.file_url ?? '')
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

/**
 * Replace every `{{name}}` in a request template. In a JSON body (`mode:
 * 'json'`) an object or array value is inserted as real JSON — including a
 * quoted `"{{name}}"`, whose quotes are dropped so the field holds the
 * object, not a string. Other values (and `mode: 'text'`) insert
 * referenceInputText(value) as before.
 */
export function substituteInputPlaceholder(template: string, name: string, value: any, mode: 'json' | 'text'): string {
  if (!template) return template
  const token = `{{${name}}}`
  if (!template.includes(token)) return template
  if (mode === 'json' && value != null && typeof value === 'object' && !isFileRef(value)) {
    const json = referenceInputText(value)
    return template.split(`"${token}"`).join(json).split(token).join(json)
  }
  return template.split(token).join(referenceInputText(value))
}
