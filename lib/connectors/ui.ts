import type { ConnectorDefinition } from './registry'

function fieldKeys(definition: ConnectorDefinition) {
  return new Set([
    ...definition.credentialFields.map((field) => field.key),
    ...definition.fields.map((field) => field.key),
  ])
}

function hasAny(keys: Set<string>, values: string[]) {
  return values.some((value) => keys.has(value))
}

function isLocalConnector(definition: ConnectorDefinition) {
  const keys = fieldKeys(definition)
  return definition.credentialFields.length === 0 || hasAny(keys, ['base_url', 'host']) && definition.key === 'ollama'
}

function usesDatabaseStyle(definition: ConnectorDefinition) {
  return definition.category === 'database'
}

function usesOAuthStyle(definition: ConnectorDefinition) {
  const keys = fieldKeys(definition)
  return hasAny(keys, ['client_id', 'client_secret', 'tenant_id', 'access_token', 'refresh_token']) &&
    !usesDatabaseStyle(definition)
}

function usesServiceAccountStyle(definition: ConnectorDefinition) {
  const keys = fieldKeys(definition)
  return hasAny(keys, ['service_account_json'])
}

function usesBotTokenStyle(definition: ConnectorDefinition) {
  const keys = fieldKeys(definition)
  return hasAny(keys, ['bot_token'])
}

function usesTokenStyle(definition: ConnectorDefinition) {
  const keys = fieldKeys(definition)
  return hasAny(keys, ['api_key', 'secret_key', 'secret_key_id', 'bot_token', 'access_token', 'token'])
}

export function getConnectorUiCopy(definition: ConnectorDefinition) {
  const local = isLocalConnector(definition)
  const database = usesDatabaseStyle(definition)
  const serviceAccount = usesServiceAccountStyle(definition)
  const botToken = usesBotTokenStyle(definition)
  const oauth = usesOAuthStyle(definition)
  const token = usesTokenStyle(definition)

  if (local) {
    return {
      credentialTitle: 'Setup',
      credentialDescription: `This connector runs against your ${definition.name} environment and does not require stored credentials.`,
      docsLabel: `View ${definition.name} setup documentation`,
      configTitle: 'Connection Settings',
      configDescription: `Configure how UserTasks should connect to ${definition.name}.`,
      referenceHeading: 'Reference Operations',
    }
  }

  if (database) {
    return {
      credentialTitle: 'Access',
      credentialDescription: `Enter the account details for your ${definition.name} connection. These are stored securely and encrypted at rest.`,
      docsLabel: `View ${definition.name} connection documentation`,
      configTitle: 'Connection Settings',
      configDescription: `Configure the server, database, and runtime options for ${definition.name}.`,
      referenceHeading: 'Reference Operations',
    }
  }

  if (serviceAccount) {
    return {
      credentialTitle: 'Service Account',
      credentialDescription: `Enter the service account credentials required for ${definition.name}. These are stored securely and encrypted at rest.`,
      docsLabel: `View ${definition.name} service account documentation`,
      configTitle: 'Integration Settings',
      configDescription: `Configure the default behavior for your ${definition.name} integration.`,
      referenceHeading: 'Available References',
    }
  }

  if (botToken) {
    return {
      credentialTitle: 'Bot Access',
      credentialDescription: `Enter the bot token and related access details for ${definition.name}. These are stored securely and encrypted at rest.`,
      docsLabel: `View ${definition.name} app setup documentation`,
      configTitle: 'Integration Settings',
      configDescription: `Configure the default behavior for your ${definition.name} integration.`,
      referenceHeading: 'Available References',
    }
  }

  if (oauth) {
    return {
      credentialTitle: 'OAuth Access',
      credentialDescription: `Enter the OAuth app registration and token details required to access ${definition.name}. These are stored securely and encrypted at rest.`,
      docsLabel: `View ${definition.name} authentication documentation`,
      configTitle: 'Integration Settings',
      configDescription: `Configure the tenant, workspace, or default behavior for ${definition.name}.`,
      referenceHeading: 'Available References',
    }
  }

  if (token) {
    return {
      credentialTitle: 'API Access',
      credentialDescription: `Enter the token or secret required to access ${definition.name}. These are stored securely and encrypted at rest.`,
      docsLabel: `View ${definition.name} API documentation`,
      configTitle: definition.category === 'ai' ? 'Model Defaults' : 'Integration Settings',
      configDescription: definition.category === 'ai'
        ? `Configure the default model and runtime behavior for ${definition.name}.`
        : `Configure the default behavior for your ${definition.name} integration.`,
      referenceHeading: 'Available References',
    }
  }

  if (definition.category === 'cloud') {
    return {
      credentialTitle: 'Access',
      credentialDescription: `Enter the access details required for ${definition.name}. These are stored securely and encrypted at rest.`,
      docsLabel: `View ${definition.name} integration documentation`,
      configTitle: 'Storage Settings',
      configDescription: `Configure the default storage location and behavior for ${definition.name}.`,
      referenceHeading: 'Available References',
    }
  }

  return {
    credentialTitle: 'Credentials',
    credentialDescription: `Enter the credentials required to access ${definition.name}. These are stored securely and encrypted at rest.`,
    docsLabel: `View ${definition.name} documentation`,
    configTitle: 'Configuration',
    configDescription: `Configure your ${definition.name} integration settings.`,
    referenceHeading: 'Available References',
  }
}
