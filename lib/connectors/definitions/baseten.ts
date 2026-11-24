import type { ConnectorDefinition } from '../registry'

/**
 * Baseten (baseten.co) — AI model inference, reached through its
 * OpenAI-compatible Chat Completions API. Two ways in, one connector:
 *
 *   Model APIs           https://inference.baseten.co/v1/chat/completions
 *                        Baseten-hosted open models picked by slug
 *                        (docs.baseten.co → Model APIs overview).
 *   Dedicated deployment https://model-{id}.api.baseten.co/environments/production/sync/v1/chat/completions
 *                        a model the customer deployed on Baseten (Truss /
 *                        an OpenAI-compatible engine); also Baseten
 *                        Self-hosted, whose workload plane runs in the
 *                        customer's own cloud account / VPC.
 *
 * Auth is `Authorization: Bearer <key>` for both (Baseten still accepts the
 * legacy `Api-Key <key>` scheme on dedicated deployments; Bearer is the
 * documented one). The key is always the customer's own (bring your own
 * key): it is a password field, encrypted at rest with the rest of the
 * connector's credentials, never returned to the browser and never part of a
 * template variable. Usage is billed by Baseten to the customer's account.
 *
 * base_url is stored WITHOUT the trailing `/v1`: the bare Model APIs host,
 * or a deployment's `…/sync` root, so the reference templates' `/v1/…` paths
 * work for both modes and lib/agents/provider.ts adds `/v1` for agents.
 */

export const BASETEN_MODEL_APIS_HOST = 'https://inference.baseten.co'
export const BASETEN_DEFAULT_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash'

/**
 * Model API slugs (docs.baseten.co Model APIs overview, checked 2026-11-21).
 * All support tool calling; JSON mode / structured outputs on all but Muse
 * Spark Open. Any other slug can be typed in Model name.
 */
export const BASETEN_MODEL_API_MODELS: { value: string; label: string }[] = [
  { value: 'deepseek-ai/DeepSeek-V4.1-Flash', label: 'DeepSeek V4.1 Flash' },
  { value: 'deepseek-ai/DeepSeek-V4.1-Flash-Fast', label: 'DeepSeek V4.1 Flash Fast' },
  { value: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', label: 'DeepSeek V4.1 Flash 1017' },
  { value: 'deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast', label: 'DeepSeek V4.1 Flash 1017 Fast' },
  { value: 'deepseek-ai/DeepSeek-V4-Pro-0813', label: 'DeepSeek V4 Pro 0813' },
  { value: 'deepseek-ai/DeepSeek-V4-Flash-0731', label: 'DeepSeek V4 Flash 0731' },
  { value: 'moonshotai/Kimi-K3.1-Pro', label: 'Kimi K3.1 Pro' },
  { value: 'moonshotai/Kimi-K3', label: 'Kimi K3' },
  { value: 'zai-org/GLM-5.3', label: 'GLM 5.3' },
  { value: 'zai-org/GLM-5.3-Fast', label: 'GLM 5.3 Fast' },
  { value: 'zai-org/GLM-5.3-Flash', label: 'GLM 5.3 Flash' },
  { value: 'zai-org/GLM-5.2', label: 'GLM 5.2' },
  { value: 'zai-org/GLM-5.2-Fast', label: 'GLM 5.2 Fast' },
  { value: 'openai/gpt-oss-120b', label: 'OpenAI GPT OSS 120B' },
  { value: 'nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B', label: 'NVIDIA Nemotron 3 Ultra' },
  { value: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B', label: 'NVIDIA Nemotron 3.5 Super VL' },
  { value: 'reflection/Beam-1.0', label: 'Beam' },
  { value: 'meta-models/muse-spark-open', label: 'Muse Spark Open (no JSON mode)' },
]

export type BasetenMode = 'model_apis' | 'dedicated'

export function basetenMode(config: Record<string, any> | null | undefined): BasetenMode {
  return config?.mode === 'dedicated' ? 'dedicated' : 'model_apis'
}

/** Is this host Baseten's (Model APIs or a model / chain deployment)? */
export function isBasetenHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'inference.baseten.co' || h.endsWith('.api.baseten.co')
}

/**
 * A dedicated deployment's OpenAI-compatible root (`…/sync`, no `/v1`), from
 * what an admin is likely to paste: a bare model id (`abcd1234`), the model
 * host, the predict URL, the `/sync/v1` base URL or the full
 * `/chat/completions` URL. Throws on anything that is not https or has
 * credentials / a query in it.
 */
export function normalizeBasetenDeploymentUrl(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('Enter the deployment URL (or model ID) from your Baseten model\'s API endpoint page')
  if (/^[a-z0-9]{4,32}$/i.test(raw)) return `https://model-${raw.toLowerCase()}.api.baseten.co/environments/production/sync`
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('The deployment URL is not a valid URL') }
  if (url.protocol !== 'https:') throw new Error('The deployment URL must use https://')
  if (url.username || url.password || url.search || url.hash) throw new Error('The deployment URL must not carry credentials, a query or a fragment')
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/chat\/completions$/i, '').replace(/\/v1$/i, '')
  if (/\/(predict|async_predict)$/i.test(path)) path = path.replace(/\/(predict|async_predict)$/i, '/sync')
  if (!/\/sync$/i.test(path)) {
    // The plain model host (model-{id}.api.baseten.co) defaults to production; a regional /
    // environment host (model-{id}-{env}.api.baseten.co) or an explicit environment path takes /sync.
    if (path === '' && /^model-[a-z0-9]+\.api\.baseten\.co$/i.test(url.hostname)) path = '/environments/production/sync'
    else path = `${path}/sync`
  }
  return `${url.origin}${path}`
}

/** The model the connection uses when an agent or a call names none. */
export function basetenModel(config: Record<string, any> | null | undefined): string {
  const custom = String(config?.custom_model ?? '').trim()
  if (custom) return custom
  if (basetenMode(config) === 'dedicated') return ''
  return String(config?.default_model ?? '').trim() || BASETEN_DEFAULT_MODEL
}

const CHAT_INPUTS = [
  { name: 'user_message', type: 'string', required: true, description: 'The user message / prompt' },
  { name: 'system_prompt', type: 'string', required: false, description: 'System prompt', defaultValue: 'You are a helpful assistant.' },
  { name: 'model', type: 'string', required: false, description: 'Model API slug (e.g. deepseek-ai/DeepSeek-V4.1-Flash) or the model name your dedicated deployment serves — empty = the connection\'s model' },
  { name: 'max_tokens', type: 'number', required: false, description: 'Maximum response tokens (reasoning models count reasoning tokens too)', defaultValue: '4096' },
  { name: 'temperature', type: 'number', required: false, description: 'Sampling temperature 0-2 (empty = the model\'s default)' },
]

const CHAT_OUTPUTS = [
  { name: 'choices.0.message.content', type: 'string' },
  { name: 'choices.0.message.reasoning_content', type: 'string' },
  { name: 'choices.0.finish_reason', type: 'string' },
  { name: 'usage', type: 'object' },
  { name: 'model', type: 'string' },
]

export const basetenConnector: ConnectorDefinition = {
  key: 'baseten',
  name: 'Baseten',
  description: 'Open models on Baseten Model APIs — DeepSeek, Kimi, GLM, GPT OSS — or your own dedicated Baseten deployment',
  category: 'ai',
  icon: 'Sparkles',
  color: '#1F2937',
  docsUrl: 'https://docs.baseten.co/development/model-apis/overview',
  recommendedPermissions: {
    title: 'Your own Baseten account',
    items: [
      'Create an API key in the Baseten dashboard (Settings → API keys). A workspace key is enough.',
      'Usage is billed by Baseten to your account; UserTasks never supplies or resells a Baseten key.',
    ],
    note: 'Dedicated deployments: copy the deployment URL (or model ID) from the model\'s API endpoint page. The deployment must serve an OpenAI-compatible /v1/chat/completions route (Baseten\'s LLM engines do).',
  },
  fields: [
    {
      key: 'mode',
      label: 'Endpoint',
      type: 'select',
      options: [
        { value: 'model_apis', label: 'Model APIs (Baseten-hosted models)' },
        { value: 'dedicated', label: 'Dedicated deployment (your model)' },
      ],
      defaultValue: 'model_apis',
      helpText: 'Model APIs: pick a hosted model. Dedicated: a model you deployed on Baseten (Baseten Cloud or Self-hosted).',
    },
    {
      // Key kept as default_model: agents read its options as model suggestions.
      key: 'default_model',
      label: 'Model',
      type: 'select',
      options: BASETEN_MODEL_API_MODELS,
      defaultValue: BASETEN_DEFAULT_MODEL,
      visibleWhen: { field: 'mode', equals: 'model_apis' },
      helpText: 'Default model for agents and workflow calls (both can name another).',
    },
    {
      key: 'deployment_url',
      label: 'Deployment URL',
      type: 'text',
      placeholder: 'https://model-abcd1234.api.baseten.co/environments/production/sync/v1',
      visibleWhen: { field: 'mode', equals: 'dedicated' },
      requiredWhen: { field: 'mode', equals: 'dedicated' },
      helpText: 'The OpenAI-compatible base URL, the predict URL or just the model ID — normalised to …/sync/v1.',
    },
    {
      key: 'custom_model',
      label: 'Model name (custom)',
      type: 'text',
      placeholder: 'e.g. moonshotai/Kimi-K3 or the name your deployment serves',
      requiredWhen: { field: 'mode', equals: 'dedicated' },
      helpText: 'Model APIs: a slug not in the list (overrides it). Dedicated: the model name your engine expects.',
    },
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', placeholder: '', required: true, helpText: 'Your own Baseten API key (app.baseten.co → Settings → API keys). Stored encrypted; never shown again.' },
  ],
  referenceTemplates: [
    {
      key: 'chat_completion', name: 'Chat Completion', description: 'Generate a chat completion (OpenAI-compatible)', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"model":"{{model}}","messages":[{"role":"system","content":"{{system_prompt}}"},{"role":"user","content":"{{user_message}}"}],"max_tokens":{{max_tokens}},"temperature":{{temperature}}}',
      inputs: CHAT_INPUTS,
      outputs: CHAT_OUTPUTS,
    },
    {
      key: 'json_completion', name: 'JSON Completion', description: 'Generate a JSON object (JSON mode) — parse choices.0.message.content', method: 'POST', pathTemplate: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      bodyTemplate: '{"model":"{{model}}","messages":[{"role":"system","content":"{{system_prompt}}"},{"role":"user","content":"{{user_message}}"}],"response_format":{"type":"json_object"},"max_tokens":{{max_tokens}},"temperature":{{temperature}}}',
      inputs: [
        CHAT_INPUTS[0],
        { ...CHAT_INPUTS[1], defaultValue: 'You are a helpful assistant. Reply with a single JSON object only.' },
        ...CHAT_INPUTS.slice(2),
      ],
      outputs: CHAT_OUTPUTS.filter((o) => o.name !== 'choices.0.message.reasoning_content'),
    },
  ],
  buildIntegrationConfig: (config, credentials) => {
    const base_url = basetenMode(config) === 'dedicated' ? normalizeBasetenDeploymentUrl(String(config.deployment_url ?? '')) : BASETEN_MODEL_APIS_HOST
    return {
      base_url,
      auth_type: 'bearer',
      auth_config: { token: credentials.api_key },
      // Read by agents (lib/agents/prepare.ts), the Agent assistant and the form wizard.
      default_model: basetenModel(config),
    }
  },
  /** The connection's model fills a call's empty {{model}} input. */
  upgradeIntegrationConfig: (stored) => {
    if (!stored || typeof stored !== 'object') return stored
    const vars = stored.template_vars && typeof stored.template_vars === 'object' ? stored.template_vars : {}
    if (vars.model) return stored
    const model = String(stored.default_model ?? '') || basetenModel(vars)
    return model ? { ...stored, template_vars: { ...vars, model } } : stored
  },
}
