/**
 * Hello — example extension, manifest entry (client-safe). The manifest
 * itself is usertasks-extension.json (read by the build-time codegen too);
 * this module adds the connector definitions, which carry code.
 */
import { defineExtension, type ConnectorDefinition } from '@user-tasks/extension-sdk'
import manifest from './usertasks-extension.json'

/**
 * A connector whose calls go through the extension's own transport
 * (`auth_config._transport`): here a loopback that answers locally, the
 * shape an NTLM / Kerberos transport takes in a real extension.
 */
const echoConnector: ConnectorDefinition = {
  key: 'echo',
  name: 'Hello Echo',
  description: 'Example connector: echoes requests back through the Hello extension\'s loopback transport.',
  category: 'productivity',
  icon: 'Repeat',
  color: '#0EA5E9',
  fields: [
    { key: 'base_url', label: 'Base URL', type: 'text', required: true, defaultValue: 'https://echo.example.invalid', validation: { type: 'url' } },
  ],
  credentialFields: [
    { key: 'token', label: 'Token', type: 'password', required: false, helpText: 'Sent as a Bearer token (echoed back without its value).' },
  ],
  referenceTemplates: [
    {
      key: 'echo',
      name: 'Echo',
      description: 'Send a message and get it back',
      method: 'POST',
      pathTemplate: '/echo',
      bodyTemplate: '{"message": "{{message}}"}',
      inputs: [{ name: 'message', type: 'string', required: true, description: 'Text to echo', location: 'body' }],
      outputs: [{ name: 'message', type: 'string' }, { name: 'transport', type: 'string' }],
    },
  ],
  buildIntegrationConfig: (config, credentials) => ({
    base_url: String(config.base_url ?? 'https://echo.example.invalid'),
    auth_type: credentials.token ? 'bearer' : 'none',
    auth_config: { ...(credentials.token ? { token: credentials.token } : {}), _transport: 'ext.example-hello.loopback' },
  }),
}

export default defineExtension({ manifest, connectors: [echoConnector] })
