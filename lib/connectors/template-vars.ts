import type { ConnectorDefinition } from './registry'
import { isSensitiveKey } from '@/lib/secret-fields'

/**
 * Non-secret connector settings usable as {{placeholders}} by the
 * connector's reference templates (account ids, API versions, sender
 * addresses, tenant names …). Stored on the backing integration as
 * config.template_vars; never includes password-type fields or keys that
 * look like credentials.
 */
export function connectorTemplateVars(
  definition: ConnectorDefinition,
  config: Record<string, any>,
  credentials: Record<string, any>,
): Record<string, string> {
  const vars: Record<string, string> = {}
  const take = (fields: ConnectorDefinition['fields'], values: Record<string, any>) => {
    for (const field of fields) {
      if (field.type === 'password' || isSensitiveKey(field.key)) continue
      const value = values?.[field.key] ?? field.defaultValue
      if (value === undefined || value === null || value === '') continue
      if (typeof value === 'object') continue
      vars[field.key] = String(value)
    }
  }
  take(definition.fields, config)
  take(definition.credentialFields, credentials)
  // Renamed settings: Workday's default_tenant became tenant.
  if (!vars.tenant && typeof config?.default_tenant === 'string' && config.default_tenant) vars.tenant = config.default_tenant
  return vars
}
