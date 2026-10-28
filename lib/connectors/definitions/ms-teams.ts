import type { ConnectorDefinition } from '../registry'

export const msTeamsConnector: ConnectorDefinition = {
  key: 'ms_teams',
  name: 'Microsoft Teams',
  description: 'Send messages and cards to a Microsoft Teams channel using an Incoming Webhook',
  category: 'communication',
  icon: 'Users',
  color: '#6264A7',
  docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
  fields: [
    {
      key: 'default_team_id',
      label: 'Default Team ID (optional)',
      type: 'text',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      helpText: 'Optional metadata so you can remember which team this webhook belongs to.',
    },
    {
      key: 'default_channel_id',
      label: 'Default Channel ID (optional)',
      type: 'text',
      placeholder: '19:xxxx@thread.tacv2',
      helpText: 'Optional metadata so you can remember which channel this webhook posts into.',
    },
  ],
  credentialFields: [
    {
      key: 'webhook_url',
      label: 'Incoming Webhook URL',
      type: 'password',
      required: true,
      placeholder: 'https://xxxxx.webhook.office.com/webhookb2/...',
      helpText: 'Paste the channel-scoped Incoming Webhook URL created from Microsoft Teams.',
    },
  ],
  referenceTemplates: [
    {
      key: 'send_message',
      name: 'Send Channel Message',
      description: 'Send a message to a Teams channel via webhook',
      method: 'POST',
      pathTemplate: '',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: '{{title}}',
        themeColor: '{{color}}',
        title: '{{title}}',
        sections: [{
          activityTitle: '{{subtitle}}',
          text: '{{message}}',
        }],
      }),
      inputs: [
        { name: 'title', type: 'string', required: true, description: 'Message card title' },
        { name: 'message', type: 'string', required: true, description: 'Message body (supports markdown)' },
        { name: 'subtitle', type: 'string', required: false, description: 'Activity subtitle' },
        { name: 'color', type: 'string', required: false, description: 'Theme color hex (no #)', defaultValue: '0076D7' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
    {
      key: 'send_adaptive_card',
      name: 'Send Adaptive Card',
      description: 'Send a rich adaptive card to a Teams channel',
      method: 'POST',
      pathTemplate: '',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: '{{card_json}}',
        }],
      }),
      inputs: [
        { name: 'card_json', type: 'string', required: true, description: 'Adaptive Card JSON payload' },
      ],
      outputs: [
        { name: 'status', type: 'number' },
      ],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: credentials.webhook_url || '',
    auth_type: 'none',
    auth_config: {},
  }),
}
