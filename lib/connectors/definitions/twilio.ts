import type { ConnectorDefinition } from '../registry'

export const twilioConnector: ConnectorDefinition = {
  key: 'twilio',
  name: 'Twilio',
  description: 'Send SMS, make voice calls, verify phone numbers, and manage communications',
  category: 'communication',
  icon: 'Phone',
  color: '#F22F46',
  docsUrl: 'https://www.twilio.com/docs/usage/api',
  recommendedPermissions: {
    title: 'Twilio credentials',
    items: ['Account SID (always needed — it is part of every API path)', 'A Standard API Key + secret (preferred) or the Auth Token'],
    note: 'Sending SMS or calls is not idempotent: a retried request can send twice, so failed sends are not retried automatically.',
  },
  fields: [
    {
      key: 'from_number',
      label: 'From Phone Number',
      type: 'text',
      placeholder: '+1234567890',
      required: true,
      helpText: 'Your Twilio phone number (E.164 format)',
    },
  ],
  credentialFields: [
    {
      key: 'account_sid',
      label: 'Account SID',
      type: 'text',
      placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      required: true,
      helpText: 'Found on your Twilio Console dashboard',
    },
    {
      key: 'auth_token',
      label: 'Auth Token',
      type: 'password',
      required: false,
      helpText: 'Found on your Twilio Console dashboard',
    },
    {
      key: 'api_key_sid',
      label: 'API Key SID (optional, recommended)',
      type: 'text',
      placeholder: 'SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      helpText: 'A Standard API key (Console → API keys) — when set, it is used instead of the Auth Token and can be revoked on its own.',
    },
    {
      key: 'api_key_secret',
      label: 'API Key Secret (optional)',
      type: 'password',
    },
  ],
  referenceTemplates: [
    // ─── SMS ───
    {
      key: 'send_sms',
      name: 'Send SMS',
      description: 'Send an SMS message',
      method: 'POST',
      pathTemplate: '/2010-04-01/Accounts/{{account_sid}}/Messages.json',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      bodyTemplate: 'To={{to_number}}&From={{from_number}}&MessagingServiceSid={{messaging_service_sid}}&Body={{message}}&StatusCallback={{status_callback}}',
      inputs: [
        { name: 'to_number', type: 'string', required: true, description: 'Recipient phone number (E.164 format, e.g. +447911123456)' },
        { name: 'from_number', type: 'string', required: false, description: 'Sender number (defaults to the connector From Phone Number)' },
        { name: 'messaging_service_sid', type: 'string', required: false, description: 'Messaging Service SID (MG…) — alternative to From' },
        { name: 'message', type: 'string', required: true, description: 'SMS message body (max 1600 chars)' },
        { name: 'status_callback', type: 'string', required: false, description: 'URL Twilio posts delivery status updates to' },
        { name: 'account_sid', type: 'string', required: false, description: 'Account SID override (defaults to the connector Account SID)' },
      ],
      outputs: [{ name: 'sid', type: 'string' }, { name: 'status', type: 'string' }, { name: 'date_created', type: 'string' }],
    },
    {
      key: 'get_message',
      name: 'Get Message Status',
      description: 'Check the delivery status of a sent message',
      method: 'GET',
      pathTemplate: '/2010-04-01/Accounts/{{account_sid}}/Messages/{{message_sid}}.json',
      inputs: [
        { name: 'message_sid', type: 'string', required: true, description: 'Message SID (SM...)' },
        { name: 'account_sid', type: 'string', required: false, description: 'Account SID override (defaults to the connector Account SID)' },
      ],
      outputs: [{ name: 'sid', type: 'string' }, { name: 'status', type: 'string' }, { name: 'error_code', type: 'number' }, { name: 'error_message', type: 'string' }],
    },
    {
      key: 'list_messages',
      name: 'List Messages',
      description: 'List sent and received messages. For the next page pass next_page_uri as next_link.',
      method: 'GET',
      pathTemplate: '/2010-04-01/Accounts/{{account_sid}}/Messages.json?To={{to_filter}}&From={{from_filter}}&DateSent>={{date_from}}&PageSize={{page_size}}',
      inputs: [
        { name: 'to_filter', type: 'string', required: false, description: 'Filter by recipient' },
        { name: 'from_filter', type: 'string', required: false, description: 'Filter by sender' },
        { name: 'date_from', type: 'string', required: false, description: 'Messages sent on or after this date (YYYY-MM-DD)' },
        { name: 'page_size', type: 'number', required: false, description: 'Results per page (max 1000)', defaultValue: '50' },
        { name: 'next_link', type: 'string', required: false, description: 'next_page_uri from the previous page' },
        { name: 'account_sid', type: 'string', required: false, description: 'Account SID override (defaults to the connector Account SID)' },
      ],
      outputs: [{ name: 'messages', type: 'array' }, { name: 'next_page_uri', type: 'string' }],
    },
    // ─── Voice ───
    {
      key: 'make_call',
      name: 'Make Voice Call',
      description: 'Initiate an outbound voice call',
      method: 'POST',
      pathTemplate: '/2010-04-01/Accounts/{{account_sid}}/Calls.json',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      bodyTemplate: 'To={{to_number}}&From={{from_number}}&Url={{twiml_url}}&Twiml={{twiml}}',
      inputs: [
        { name: 'to_number', type: 'string', required: true, description: 'Number to call (E.164)' },
        { name: 'from_number', type: 'string', required: false, description: 'Caller ID number (defaults to the connector From Phone Number)' },
        { name: 'twiml_url', type: 'string', required: false, description: 'URL returning TwiML instructions (set this or twiml)' },
        { name: 'twiml', type: 'string', required: false, description: 'Inline TwiML (e.g. <Response><Say>Hello!</Say></Response>)' },
        { name: 'account_sid', type: 'string', required: false, description: 'Account SID override (defaults to the connector Account SID)' },
      ],
      outputs: [{ name: 'sid', type: 'string' }, { name: 'status', type: 'string' }],
    },
    {
      key: 'get_call',
      name: 'Get Call Status',
      description: 'Check the status of a call',
      method: 'GET',
      pathTemplate: '/2010-04-01/Accounts/{{account_sid}}/Calls/{{call_sid}}.json',
      inputs: [
        { name: 'call_sid', type: 'string', required: true, description: 'Call SID (CA...)' },
        { name: 'account_sid', type: 'string', required: false, description: 'Account SID override (defaults to the connector Account SID)' },
      ],
      outputs: [{ name: 'sid', type: 'string' }, { name: 'status', type: 'string' }, { name: 'duration', type: 'string' }, { name: 'direction', type: 'string' }],
    },
    // ─── Verify (2FA) ───
    {
      key: 'send_verification',
      name: 'Send Verification Code',
      description: 'Send a verification code via SMS or voice for 2FA',
      method: 'POST',
      baseUrl: 'https://verify.twilio.com',
      pathTemplate: '/v2/Services/{{verify_service_sid}}/Verifications',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      bodyTemplate: 'To={{to_number}}&Channel={{channel}}',
      inputs: [
        { name: 'verify_service_sid', type: 'string', required: true, description: 'Verify Service SID (VA...)' },
        { name: 'to_number', type: 'string', required: true, description: 'Number to verify (E.164)' },
        { name: 'channel', type: 'string', required: false, description: 'sms, call, or email', defaultValue: 'sms' },
      ],
      outputs: [{ name: 'sid', type: 'string' }, { name: 'status', type: 'string' }, { name: 'to', type: 'string' }],
    },
    {
      key: 'check_verification',
      name: 'Check Verification Code',
      description: 'Verify a code entered by the user',
      method: 'POST',
      baseUrl: 'https://verify.twilio.com',
      pathTemplate: '/v2/Services/{{verify_service_sid}}/VerificationCheck',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      bodyTemplate: 'To={{to_number}}&Code={{code}}',
      inputs: [
        { name: 'verify_service_sid', type: 'string', required: true, description: 'Verify Service SID' },
        { name: 'to_number', type: 'string', required: true, description: 'Number that was verified' },
        { name: 'code', type: 'string', required: true, description: 'Code entered by user' },
      ],
      outputs: [{ name: 'sid', type: 'string' }, { name: 'status', type: 'string' }, { name: 'valid', type: 'boolean' }],
    },
    // ─── Lookup ───
    {
      key: 'lookup_number',
      name: 'Lookup Phone Number',
      description: 'Look up information about a phone number (carrier, type, caller name)',
      method: 'GET',
      baseUrl: 'https://lookups.twilio.com',
      pathTemplate: '/v2/PhoneNumbers/{{phone_number}}?Fields={{fields}}',
      inputs: [
        { name: 'phone_number', type: 'string', required: true, description: 'Phone number (E.164)' },
        { name: 'fields', type: 'string', required: false, description: 'Data to return: line_type_intelligence, caller_name, sim_swap', defaultValue: 'line_type_intelligence' },
      ],
      outputs: [{ name: 'phone_number', type: 'string' }, { name: 'country_code', type: 'string' }, { name: 'line_type_intelligence', type: 'object' }],
    },
  ],
  buildIntegrationConfig: (_config, credentials) => {
    const useApiKey = Boolean(credentials.api_key_sid && credentials.api_key_secret)
    return {
      base_url: 'https://api.twilio.com',
      auth_type: 'basic',
      auth_config: useApiKey
        ? { username: credentials.api_key_sid, password: credentials.api_key_secret }
        : { username: credentials.account_sid, password: credentials.auth_token },
    }
  },
}
