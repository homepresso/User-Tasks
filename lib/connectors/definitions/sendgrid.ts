import type { ConnectorDefinition } from '../registry'

export const sendgridConnector: ConnectorDefinition = {
  key: 'sendgrid',
  name: 'SendGrid',
  description: 'Send transactional and marketing emails via SendGrid',
  category: 'communication',
  icon: 'Mail',
  color: '#1A82E2',
  docsUrl: 'https://docs.sendgrid.com/api-reference',
  fields: [
    {
      key: 'from_email',
      label: 'Default From Email',
      type: 'text',
      placeholder: 'noreply@yourcompany.com',
      required: true,
      helpText: 'Verified sender email address',
    },
    {
      key: 'from_name',
      label: 'Default From Name',
      type: 'text',
      placeholder: 'Your Company',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      placeholder: 'SG.xxxxxxxx',
      required: true,
      helpText: 'SendGrid API Key with Mail Send permissions',
    },
  ],
  referenceTemplates: [
    {
      key: 'send_email',
      name: 'Send Email',
      description: 'Send a single email to a recipient',
      method: 'POST',
      pathTemplate: '/v3/mail/send',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({
        personalizations: [{ to: [{ email: '{{to_email}}', name: '{{to_name}}' }] }],
        from: { email: '{{from_email}}', name: '{{from_name}}' },
        subject: '{{subject}}',
        content: [{ type: 'text/html', value: '{{body}}' }],
      }),
      inputs: [
        { name: 'to_email', type: 'string', required: true, description: 'Recipient email address' },
        { name: 'to_name', type: 'string', required: false, description: 'Recipient name' },
        { name: 'from_email', type: 'string', required: false, description: 'Override sender email' },
        { name: 'from_name', type: 'string', required: false, description: 'Override sender name' },
        { name: 'subject', type: 'string', required: true, description: 'Email subject line' },
        { name: 'body', type: 'string', required: true, description: 'Email body (HTML)' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
    {
      key: 'send_template_email',
      name: 'Send Template Email',
      description: 'Send email using a SendGrid dynamic template',
      method: 'POST',
      pathTemplate: '/v3/mail/send',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({
        personalizations: [{
          to: [{ email: '{{to_email}}' }],
          dynamic_template_data: '{{template_data}}',
        }],
        from: { email: '{{from_email}}' },
        template_id: '{{template_id}}',
      }),
      inputs: [
        { name: 'to_email', type: 'string', required: true, description: 'Recipient email' },
        { name: 'from_email', type: 'string', required: false, description: 'Override sender' },
        { name: 'template_id', type: 'string', required: true, description: 'SendGrid template ID (d-xxxxx)' },
        { name: 'template_data', type: 'string', required: false, description: 'JSON object of template variables' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://api.sendgrid.com',
    auth_type: 'bearer',
    auth_config: { token: credentials.api_key },
  }),
}
