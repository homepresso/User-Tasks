import type { ConnectorField } from "./registry"
import { isCiphertext } from "@/lib/secret-format"

function matchesCondition(
  value: unknown,
  condition?: ConnectorField["visibleWhen"] | ConnectorField["requiredWhen"],
) {
  if (!condition) return true
  if (condition.in && condition.in.length > 0) {
    return condition.in.includes(value as string | number | boolean)
  }
  if (condition.equals !== undefined) {
    return value === condition.equals
  }
  if (condition.notEquals !== undefined) {
    return value !== condition.notEquals
  }
  return true
}

export function isConnectorFieldVisible(field: ConnectorField, values: Record<string, any>) {
  if (!field.visibleWhen) return true
  return matchesCondition(values[field.visibleWhen.field], field.visibleWhen)
}

export function isConnectorFieldRequired(field: ConnectorField, values: Record<string, any>) {
  if (!isConnectorFieldVisible(field, values)) return false
  if (field.requiredWhen) {
    return matchesCondition(values[field.requiredWhen.field], field.requiredWhen)
  }
  return Boolean(field.required)
}

export function getVisibleConnectorFields(fields: ConnectorField[], values: Record<string, any>) {
  return fields.filter((field) => isConnectorFieldVisible(field, values))
}

export function getMissingConnectorFields(fields: ConnectorField[], values: Record<string, any>) {
  return getVisibleConnectorFields(fields, values).filter((field) => {
    if (!isConnectorFieldRequired(field, values)) return false
    const value = values[field.key]
    return value === undefined || value === null || value === ''
  })
}

function isBlank(value: unknown) {
  return value === undefined || value === null || value === ''
}

function isJson(value: string, requireObject = false) {
  try {
    const parsed = JSON.parse(value)
    if (!requireObject) return true
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

export function getConnectorFieldValidationError(field: ConnectorField, values: Record<string, any>) {
  if (!isConnectorFieldVisible(field, values)) return null
  const value = values[field.key]
  if (isBlank(value)) return null

  const raw = String(value).trim()
  // Secrets encrypted at rest round-trip through edit forms as `enc:v1:…` / `enc:v2:…`
  // envelopes the browser cannot decrypt — never reject those on format.
  // Server-side callers decrypt before validating, so real values are still checked.
  if (isCiphertext(raw)) return null
  const validation = field.validation
  if (!validation) return null

  switch (validation.type) {
    case 'url': {
      try {
        const parsed = new URL(raw)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return validation.message ?? 'Enter a valid http:// or https:// URL.'
        }
        return null
      } catch {
        return validation.message ?? 'Enter a valid http:// or https:// URL.'
      }
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
        ? null
        : (validation.message ?? 'Enter a valid email address.')
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
        ? null
        : (validation.message ?? 'Enter a valid UUID.')
    case 'json':
      return isJson(raw) ? null : (validation.message ?? 'Enter valid JSON.')
    case 'json_object':
      return isJson(raw, true) ? null : (validation.message ?? 'Enter a valid JSON object.')
    case 'hostname':
      return /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[A-Za-z]{2,63}$/.test(raw)
        ? null
        : (validation.message ?? 'Enter a valid hostname without http:// or https://.')
    case 'mongo_connection':
      return /^(mongodb(\+srv)?:\/\/)(?!.*@).+/i.test(raw)
        ? null
        : (validation.message ?? 'Enter a MongoDB connection string without embedded credentials.')
    case 'azure_storage_account':
      return /^[a-z0-9]{3,24}$/.test(raw)
        ? null
        : (validation.message ?? 'Use 3-24 lowercase letters or numbers.')
    case 'azure_container':
      return /^(?=.{3,63}$)(?!-)(?!.*--)[a-z0-9-]+(?<!-)$/.test(raw)
        ? null
        : (validation.message ?? 'Use 3-63 lowercase letters, numbers, or single hyphens.')
    case 'azure_resource_name':
      return /^(?=.{2,64}$)[a-z0-9-]+$/.test(raw)
        ? null
        : (validation.message ?? 'Use 2-64 lowercase letters, numbers, or hyphens.')
    case 'aws_bucket':
      return /^(?!\d+\.\d+\.\d+\.\d+$)(?=.{3,63}$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(raw)
        ? null
        : (validation.message ?? 'Enter a valid S3 bucket name.')
    default:
      return null
  }
}

export function getConnectorFieldErrors(fields: ConnectorField[], values: Record<string, any>) {
  return Object.fromEntries(
    getVisibleConnectorFields(fields, values)
      .map((field) => [field.key, getConnectorFieldValidationError(field, values)])
      .filter(([, error]) => Boolean(error))
  ) as Record<string, string>
}

export function validateConnectorFields(fields: ConnectorField[], values: Record<string, any>, label: string) {
  const missing = getMissingConnectorFields(fields, values)
  if (missing.length === 0) return
  const names = missing.map((field) => field.label).join(', ')
  throw new Error(`Missing required ${label}: ${names}`)
}

export function validateConnectorFieldFormats(fields: ConnectorField[], values: Record<string, any>, label: string) {
  const errors = getConnectorFieldErrors(fields, values)
  const messages = Object.entries(errors).map(([key, error]) => {
    const field = fields.find((entry) => entry.key === key)
    return `${field?.label ?? key}: ${error}`
  })
  if (messages.length > 0) {
    throw new Error(`Invalid ${label}: ${messages.join(' ')}`)
  }
}
