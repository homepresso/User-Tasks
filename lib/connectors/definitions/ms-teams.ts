import type { ConnectorDefinition } from '../registry'

/**
 * Microsoft Teams channel messages through a Workflows (Power Automate)
 * webhook. The classic Office 365 connector Incoming Webhooks
 * (*.webhook.office.com) were switched off by Microsoft in May 2026; the
 * Workflows "Post to a channel when a webhook request is received" trigger
 * replaces them and expects an Adaptive Card message:
 *   { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {…} }] }
 *
 * The webhook URL carries its own signature (…&sig=…), so it is a secret:
 * it lives in auth_config.webhook_url (encrypted), never in base_url.
 */

const WEBHOOK_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*(logic\.azure\.com|powerplatform\.com|webhook\.office\.com)(:443)?\//i

export function isTeamsWebhookUrl(url: unknown): boolean {
  return typeof url === 'string' && WEBHOOK_HOST_RE.test(url.trim())
}

export const msTeamsConnector: ConnectorDefinition = {
  key: 'ms_teams',
  name: 'Microsoft Teams',
  description: 'Post messages and Adaptive Cards to a Microsoft Teams channel through a Workflows webhook',
  category: 'communication',
  icon: 'Users',
  color: '#6264A7',
  docsUrl: 'https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498',
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
      label: 'Workflows Webhook URL',
      type: 'password',
      required: true,
      validation: { type: 'url' },
      placeholder: 'https://prod-00.westus.logic.azure.com:443/workflows/…/triggers/manual/paths/invoke?api-version=2016-06-01&sp=…&sig=…',
      helpText: 'In Teams: channel ••• > Workflows > "Send webhook alerts to a channel" (or "Post to a channel when a webhook request is received"), then copy the URL. Classic Office 365 connector webhooks (webhook.office.com) were retired by Microsoft in May 2026.',
      setupHint: 'Treat the URL as a password: anyone with it can post to the channel.',
    },
  ],
  referenceTemplates: [
    {
      key: 'send_message',
      name: 'Send Channel Message',
      description: 'Post a message (title, optional subtitle, Markdown text) to the channel as an Adaptive Card',
      method: 'POST',
      pathTemplate: '',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: JSON.stringify({
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: '{{title}}', weight: 'Bolder', size: 'Medium', wrap: true },
              { type: 'TextBlock', text: '{{subtitle}}', isSubtle: true, spacing: 'None', wrap: true },
              { type: 'TextBlock', text: '{{message}}', wrap: true },
            ],
            msteams: { width: 'Full' },
          },
        }],
      }),
      inputs: [
        { name: 'title', type: 'string', required: true, description: 'Card title' },
        { name: 'message', type: 'string', required: true, description: 'Message body (Adaptive Card Markdown subset)' },
        { name: 'subtitle', type: 'string', required: false, description: 'Smaller line under the title' },
      ],
      outputs: [
        { name: 'success', type: 'boolean' },
      ],
    },
    {
      key: 'send_adaptive_card',
      name: 'Send Adaptive Card',
      description: 'Post a custom Adaptive Card (the card object itself, version 1.5 or lower) to the channel',
      method: 'POST',
      pathTemplate: '',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","contentUrl":null,"content":{{card_json}}}]}',
      inputs: [
        { name: 'card_json', type: 'object', required: true, description: 'Adaptive Card JSON ({"type":"AdaptiveCard","version":"1.4","body":[…]})' },
      ],
      outputs: [
        { name: 'success', type: 'boolean' },
      ],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: '',
    auth_type: 'none',
    auth_config: { webhook_url: String(credentials.webhook_url ?? '').trim() },
  }),
  // Rows stored before Oct 2026 kept the webhook (a secret) in base_url.
  upgradeIntegrationConfig: (stored) => {
    const baseUrl = typeof stored?.base_url === 'string' ? stored.base_url.trim() : ''
    const authConfig = stored?.auth_config && typeof stored.auth_config === 'object' ? stored.auth_config : {}
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return stored
    if (authConfig.webhook_url) return { ...stored, base_url: '' }
    return { ...stored, base_url: '', auth_type: 'none', auth_config: { ...authConfig, webhook_url: baseUrl } }
  },
}
