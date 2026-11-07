import type { ConnectorDefinition } from '../registry'

const DEFAULT_MODEL = 'gemini-3.8-flash'
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'
const API_KEY_HEADER = 'x-goog-api-key'

/**
 * Gemini API (Google AI Studio keys). The key travels in the x-goog-api-key
 * header — never in the URL, where it would end up in logs.
 *
 * The connector's Default Model setting (default_model) is copied to the
 * template variable {{model}} on read (upgradeIntegrationConfig): a call that
 * leaves the model input empty uses it.
 */
export const googleGeminiConnector: ConnectorDefinition = {
  key: 'google_gemini',
  name: 'Google Gemini',
  description: 'AI-powered text generation, analysis, vision, and embeddings with Google Gemini',
  category: 'ai',
  icon: 'Sparkles',
  color: '#4285F4',
  docsUrl: 'https://ai.google.dev/api',
  fields: [
    {
      // Key kept as default_model (agents read its options); exposed to templates as {{model}}.
      key: 'default_model',
      label: 'Default Model',
      type: 'select',
      options: [
        { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
        { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
        { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
        { value: 'gemini-4-argon', label: 'Gemini 4 Argon' },
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (existing projects only)' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (existing projects only)' },
      ],
      defaultValue: DEFAULT_MODEL,
      helpText: 'Used when a call does not name a model.',
    },
  ],
  credentialFields: [
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'AIzaSy...',
      helpText: 'API key from Google AI Studio (aistudio.google.com)',
    },
  ],
  referenceTemplates: [
    {
      key: 'generate_content',
      name: 'Generate Content',
      description: 'Generate text from a prompt. The reply text is candidates[0].content.parts[*].text.',
      method: 'POST',
      pathTemplate: '/v1beta/models/{{model}}:generateContent',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"contents": [{"role": "user", "parts": [{"text": "{{prompt}}"}]}], "systemInstruction": {"parts": [{"text": "{{system_prompt}}"}]}, "generationConfig": {"temperature": {{temperature}}, "maxOutputTokens": {{max_tokens}}, "responseMimeType": {{response_mime_type}}}}',
      inputs: [
        { name: 'prompt', type: 'string', required: true, description: 'User prompt / message' },
        { name: 'system_prompt', type: 'string', required: false, description: 'System instruction', defaultValue: 'You are a helpful assistant.' },
        { name: 'model', type: 'string', required: false, description: "Model (defaults to the connector's Default Model)" },
        { name: 'temperature', type: 'number', required: false, description: "Temperature (0-2; empty = the model's default)" },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max output tokens (thinking tokens count against it)', defaultValue: '8192' },
        { name: 'response_mime_type', type: 'string', required: false, description: 'application/json for JSON output' },
      ],
      outputs: [{ name: 'candidates', type: 'array' }, { name: 'usageMetadata', type: 'object' }, { name: 'promptFeedback', type: 'object' }, { name: 'modelVersion', type: 'string' }],
    },
    {
      key: 'generate_content_with_image',
      name: 'Generate Content (with Image)',
      description: 'Generate text from a prompt with an inline image (vision; up to about 20 MB per request)',
      method: 'POST',
      pathTemplate: '/v1beta/models/{{model}}:generateContent',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"contents": [{"role": "user", "parts": [{"text": "{{prompt}}"}, {"inlineData": {"mimeType": "{{mime_type}}", "data": "{{image_base64}}"}}]}], "generationConfig": {"maxOutputTokens": {{max_tokens}}}}',
      inputs: [
        { name: 'prompt', type: 'string', required: true, description: 'Prompt describing what to do with the image' },
        { name: 'image_base64', type: 'string', required: true, description: 'Base64-encoded image data' },
        { name: 'mime_type', type: 'string', required: false, description: 'Image MIME type', defaultValue: 'image/png' },
        { name: 'model', type: 'string', required: false, description: "Model (defaults to the connector's Default Model)" },
        { name: 'max_tokens', type: 'number', required: false, description: 'Max output tokens', defaultValue: '8192' },
      ],
      outputs: [{ name: 'candidates', type: 'array' }, { name: 'usageMetadata', type: 'object' }, { name: 'promptFeedback', type: 'object' }],
    },
    {
      key: 'embed_content',
      name: 'Embed Content',
      description: 'Generate a vector embedding for text',
      method: 'POST',
      pathTemplate: '/v1beta/models/{{embedding_model}}:embedContent',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"content": {"parts": [{"text": "{{text}}"}]}, "taskType": {{task_type}}, "outputDimensionality": {{output_dimensionality}}}',
      inputs: [
        { name: 'text', type: 'string', required: true, description: 'Text to embed' },
        { name: 'task_type', type: 'string', required: false, description: 'RETRIEVAL_QUERY, RETRIEVAL_DOCUMENT, SEMANTIC_SIMILARITY, CLASSIFICATION, CLUSTERING', defaultValue: 'RETRIEVAL_DOCUMENT' },
        { name: 'embedding_model', type: 'string', required: false, description: 'Embedding model', defaultValue: DEFAULT_EMBEDDING_MODEL },
        { name: 'output_dimensionality', type: 'number', required: false, description: 'Truncate the vector to this many dimensions (e.g. 768)' },
      ],
      outputs: [{ name: 'embedding', type: 'object' }],
    },
    {
      key: 'count_tokens',
      name: 'Count Tokens',
      description: 'Count the number of tokens in a prompt',
      method: 'POST',
      pathTemplate: '/v1beta/models/{{model}}:countTokens',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"contents": [{"role": "user", "parts": [{"text": "{{text}}"}]}]}',
      inputs: [
        { name: 'text', type: 'string', required: true, description: 'Text to count tokens for' },
        { name: 'model', type: 'string', required: false, description: "Model (defaults to the connector's Default Model)" },
      ],
      outputs: [{ name: 'totalTokens', type: 'number' }],
    },
    {
      key: 'list_models',
      name: 'List Models',
      description: 'List available Gemini models. Page with page_token = the previous nextPageToken.',
      method: 'GET',
      pathTemplate: '/v1beta/models?pageSize={{page_size}}&pageToken={{page_token}}',
      inputs: [
        { name: 'page_size', type: 'number', required: false, description: 'Models per page (max 1000)', defaultValue: '100' },
        { name: 'page_token', type: 'string', required: false, description: 'nextPageToken from the previous page' },
      ],
      outputs: [{ name: 'models', type: 'array' }, { name: 'nextPageToken', type: 'string' }],
    },
  ],
  /**
   * - Integrations stored by older definitions sent the key as ?key= (their
   *   references carry a ?key={{api_key}} pair, which now renders empty and
   *   is dropped) — move it to the x-goog-api-key header.
   * - The Default Model setting (template var default_model) becomes {{model}}.
   */
  upgradeIntegrationConfig: (stored) => {
    if (!stored || typeof stored !== 'object') return stored
    let next = stored
    const auth = stored.auth_config
    if (stored.auth_type === 'api_key' && auth && auth.add_to === 'query') {
      next = { ...next, auth_config: { ...auth, key_name: API_KEY_HEADER, add_to: 'header' } }
    }
    const vars = stored.template_vars
    if (vars && typeof vars === 'object' && !vars.model) {
      next = { ...next, template_vars: { ...vars, model: vars.default_model || DEFAULT_MODEL } }
    }
    return next
  },
  buildIntegrationConfig: (_config, credentials) => ({
    base_url: 'https://generativelanguage.googleapis.com',
    auth_type: 'api_key',
    auth_config: {
      key_name: API_KEY_HEADER,
      key_value: credentials.api_key,
      add_to: 'header',
    },
  }),
}
