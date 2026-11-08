/**
 * The Agent (client-safe): the shapes shared by Settings → Agent, the
 * availability read, the chat endpoint (/api/assistants/chat) and the Agent
 * panel.
 *
 * There is ONE Agent: a persistent chat available on every screen for the
 * people an admin allows. What it can do on a screen follows the screen and
 * the person's own permissions — four tool groups:
 *
 *  - form      form help: reads the form being filled, proposes values (never submits);
 *  - task      task help: summarises, drafts, suggests (never completes);
 *  - designer  building help: reads (anyone with view permissions) and builds
 *              workflows, forms, data tables, decision tables and form plugins
 *              through the MCP tools (builders only), with confirmation, drafts only;
 *  - admin     admin help: explains settings, access, audit, usage and workspace
 *              health, and makes confirmed admin changes (team, roles, org,
 *              branding, retention) with each tool's own permission — never
 *              secrets, SSO, the workspace address, billing or the Agent's own
 *              settings (lib/assistants/tools/admin.ts).
 *
 * Nothing shows unless the workspace configured a provider key AND turned the
 * Agent on AND the person is allowed (lib/assistants/config.ts).
 *
 * (Internally the modules keep the "assistant" name: the table, route and
 * permission ids — assistant_settings, /api/assistants/chat,
 * assistants.manage — are unchanged.)
 */
import type { ThinkingGroup, ThinkingLevel } from '@/lib/agents/reasoning'
import type { AgentProviderKind } from '@/lib/agents/provider'
import type { ModelRule } from './model-rules'
import type { AgentProfile, ClientProfile } from './profiles'

/** The Agent's tool groups (also the `capability` recorded on each usage row). */
export const ASSISTANT_CAPABILITIES = ['form', 'task', 'designer'] as const
export type AssistantCapability = (typeof ASSISTANT_CAPABILITIES)[number]

/** The name people see. */
export const AGENT_NAME = 'Agent'

export const CAPABILITY_LABELS: Record<AssistantCapability, string> = {
  form: 'Form help',
  task: 'Task help',
  designer: 'Building help',
}

/**
 * The Advanced help groups (Settings → Agent → Advanced): the three
 * capabilities plus Admin help. Admin turns are recorded on the usage row as
 * 'designer' (the usage table's capability check predates Admin help).
 */
export const AGENT_TOOL_GROUPS = ['form', 'task', 'designer', 'admin'] as const
export type AgentToolGroup = (typeof AGENT_TOOL_GROUPS)[number]

export const TOOL_GROUP_LABELS: Record<AgentToolGroup, string> = { ...CAPABILITY_LABELS, admin: 'Admin help' }

/** The providers offered in Settings → Agent (provider kinds of lib/agents/provider.ts). */
export const ASSISTANT_PROVIDERS = ['openai', 'anthropic', 'xai', 'gemini', 'azure_openai', 'mistral', 'groq', 'ollama', 'other'] as const
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number] & AgentProviderKind

export interface ProviderPreset {
  label: string
  /** Base URL used when the admin leaves it empty (null: the admin must enter one). */
  defaultBaseUrl: string | null
  /** Show the base URL field. */
  baseUrl: 'hidden' | 'optional' | 'required'
  defaultModel: string
  /** Suggested models (free text is allowed too). */
  models: string[]
  /** A key is required (Ollama and OpenAI-compatible servers may run without one). */
  keyRequired: boolean
  keyPlaceholder: string
  help: string
}

export const PROVIDER_PRESETS: Record<AssistantProvider, ProviderPreset> = {
  openai: {
    label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com', baseUrl: 'optional', defaultModel: 'gpt-4.1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'], keyRequired: true, keyPlaceholder: 'sk-…',
    help: 'An API key from platform.openai.com → API keys.',
  },
  anthropic: {
    label: 'Anthropic Claude', defaultBaseUrl: 'https://api.anthropic.com', baseUrl: 'optional', defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-4-6', 'claude-haiku-4-5'], keyRequired: true, keyPlaceholder: 'sk-ant-…',
    help: 'An API key from console.anthropic.com (reached through Claude\'s OpenAI-compatible endpoint).',
  },
  xai: {
    label: 'xAI Grok', defaultBaseUrl: 'https://api.x.ai', baseUrl: 'optional', defaultModel: 'grok-4',
    models: ['grok-4', 'grok-4-fast', 'grok-3-mini'], keyRequired: true, keyPlaceholder: 'xai-…',
    help: 'An API key from console.x.ai.',
  },
  gemini: {
    label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com', baseUrl: 'optional', defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'], keyRequired: true, keyPlaceholder: 'AIza…',
    help: 'An API key from Google AI Studio (aistudio.google.com).',
  },
  azure_openai: {
    label: 'Azure OpenAI', defaultBaseUrl: null, baseUrl: 'required', defaultModel: 'gpt-4.1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'], keyRequired: true, keyPlaceholder: 'Azure key',
    help: 'Your resource endpoint (https://<resource>.openai.azure.com) and a key; the model is your deployment name.',
  },
  mistral: {
    label: 'Mistral', defaultBaseUrl: 'https://api.mistral.ai', baseUrl: 'optional', defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'], keyRequired: true, keyPlaceholder: 'Mistral key',
    help: 'An API key from console.mistral.ai.',
  },
  groq: {
    label: 'Groq', defaultBaseUrl: 'https://api.groq.com', baseUrl: 'optional', defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'], keyRequired: true, keyPlaceholder: 'gsk_…',
    help: 'An API key from console.groq.com.',
  },
  ollama: {
    label: 'Ollama', defaultBaseUrl: 'http://localhost:11434', baseUrl: 'required', defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5', 'mistral'], keyRequired: false, keyPlaceholder: 'Optional',
    help: 'Your Ollama server\'s address. The model must support tool calling.',
  },
  other: {
    label: 'OpenAI-compatible', defaultBaseUrl: null, baseUrl: 'required', defaultModel: '',
    models: [], keyRequired: false, keyPlaceholder: 'Optional',
    help: 'Any server with an OpenAI-compatible /chat/completions endpoint and tool calling (vLLM, LiteLLM, a gateway…). Enter its base URL, e.g. https://llm.example.com/v1.',
  },
}

export function isAssistantProvider(value: unknown): value is AssistantProvider {
  return typeof value === 'string' && (ASSISTANT_PROVIDERS as readonly string[]).includes(value)
}

/** Who may use the Agent: everyone (both lists empty), else holders of a listed role or members of a listed team. */
export interface CapabilityAccess {
  enabled: boolean
  /** Role ids (workspace roles). */
  roles: string[]
  /** Team (group) ids. */
  teams: string[]
}

/** Legacy (first release) per-capability shape, still read from stored rows. */
export interface FormCapabilityAccess extends CapabilityAccess {
  /** true: every form unless a form turns it off; false: only forms that turn it on. */
  all_forms: boolean
}

/**
 * The Agent's settings (stored in assistant_settings.capabilities, version 2).
 * One switch and one access list; what a person can do is governed by their
 * permissions. `tools` are the advanced per-group switches (all on by default).
 */
export interface AgentSettings extends CapabilityAccess {
  tools: Record<AgentToolGroup, boolean>
  /** Form help on every form unless a form turns it off (true), or only on forms that turn it on (false). */
  all_forms: boolean
  /**
   * Ordered profiles (lib/assistants/profiles.ts): who gets which Agent
   * configuration (model, help groups, instructions, starters, limits); first
   * match wins, none → the Default profile (these top-level settings).
   * Version 2 rows' model rules are read as model-only profiles.
   */
  profiles: AgentProfile[]
  /** The default model's thinking level (lib/agents/reasoning.ts); 'default' = the provider's default. */
  thinking_level: ThinkingLevel
  /** Per help group overrides (Advanced): building, form, task help. A profile's own level wins over these. */
  thinking_levels: Partial<Record<ThinkingGroup, ThinkingLevel>>
}

/** A rule as the settings page sends it: `api_key` sets a new key for a `key` rule ('' / '__SECRET__' keep the saved one). */
export type ModelRuleInput = Partial<ModelRule> & { api_key?: string }

/** A profile as the settings page sends it: `api_key` sets a new key for a `key` connection ('' / '__SECRET__' keep the saved one). */
export type ProfileInput = Partial<AgentProfile> & { api_key?: string }

/** `model_rules` (version 2 input) is still accepted: mapped to model-only profiles. */
export type AgentSettingsInput = Partial<Omit<AgentSettings, 'tools' | 'profiles'>> & { tools?: Partial<AgentSettings['tools']>; profiles?: ProfileInput[]; model_rules?: ModelRuleInput[] }

export interface AssistantLimits {
  /** Messages one person may send per day (rolling 24 hours); 0 = no limit. */
  messages_per_user_per_day: number
  /** Monthly cost cap for the workspace's Agent (calendar month, UTC); 0 = no cap. */
  monthly_cost_cap: number
  cost_currency: string
  /**
   * Token limit per Agent request (all its LLM calls; cache reads count a
   * tenth); 0 = unlimited (the default). When set, a request stops before
   * the call that would pass it, resumably ("say continue").
   */
  max_request_tokens: number
}

/** The settings as the admin page sees them. The key is never included — only whether one is saved and its last 4 characters. */
export interface AssistantSettingsView {
  configured: boolean
  provider: AssistantProvider
  /** 'key': a key saved here; 'integration': an existing Integrations connection. */
  key_source: 'key' | 'integration'
  integration_id: string | null
  base_url: string | null
  model: string
  key_saved: boolean
  /** "•••• abcd", or null. */
  key_hint: string | null
  agent: AgentSettings
  limits: AssistantLimits
  last_test_status: 'ok' | 'failed' | null
  last_test_message: string | null
  last_tested_at: string | null
  updated_at: string | null
  /** Usage this month (for the limits section). */
  usage?: { messages_today: number; cost_this_month: number; currency: string; unpriced_calls: number }
  /** Configured models without a price (the monthly cost cap can't count them). */
  unpriced_models?: string[]
}

export interface AssistantSettingsInput {
  provider?: AssistantProvider
  key_source?: 'key' | 'integration'
  integration_id?: string | null
  base_url?: string | null
  model?: string
  /** A new key; '' / undefined / '__SECRET__' keep the saved one. */
  api_key?: string
  agent?: AgentSettingsInput
  limits?: Partial<AssistantLimits>
}

/**
 * What the browser learns about availability, for the signed-in person on
 * this screen: booleans, plus an opaque key for their stored conversation.
 *
 *  - agent      the Agent button shows (configured, on, the person allowed);
 *  - form_read  the form on screen may be read (form help on, the form not opted out);
 *  - form       values may be proposed on it (form_read + forms.submit);
 *  - task       task help (a task permission);
 *  - designer   building writes (a build permission) — reads follow view permissions;
 *  - admin      admin help (Admin help on + an admin permission; each tool needs its own);
 *  - history_key  sha-256 of user + workspace: the browser keys the stored
 *                 conversation by it, so it never crosses people or workspaces.
 */
export interface AssistantAvailability {
  agent: boolean
  form_read: boolean
  form: boolean
  task: boolean
  designer: boolean
  admin: boolean
  history_key?: string | null
  /** The person's Agent profile here (panel header and starters only), or null for the Default profile. */
  profile?: ClientProfile | null
}

export const NO_ASSISTANTS: AssistantAvailability = { agent: false, form_read: false, form: false, task: false, designer: false, admin: false }

/* ── Per-form setting (stored on the form layout: layout.assistant) ── */

/** 'on' / 'off' override the workspace's "all forms" default for form help; absent follows it. 'off' never turns the whole Agent off. */
export type FormAssistantSetting = 'on' | 'off'

export function formAssistantSetting(layout: unknown): FormAssistantSetting | null {
  const v = layout && typeof layout === 'object' ? (layout as { assistant?: unknown }).assistant : undefined
  return v === 'on' || v === 'off' ? v : null
}

/* ── The live form the Agent sees (sent by the browser each turn) ── */

export interface FormSnapshotField {
  key: string
  label: string
  type: string
  required?: boolean
  options?: Array<{ value: string; label: string }>
  help_text?: string
  placeholder?: string
  min?: number
  max?: number
  min_length?: number
  max_length?: number
  pattern?: string
  pattern_message?: string
  min_date?: string
  max_date?: string
  /** Shown to the person right now (hidden fields are never sent to the model). */
  visible: boolean
  /** Not editable (the field's own read-only flag, or the whole form is read-only). */
  read_only: boolean
  /** A credential-like field: its value is never sent and it cannot be set. */
  secret: boolean
  value: unknown
  error?: string
}

export interface FormSnapshot {
  title?: string
  read_only?: boolean
  fields: FormSnapshotField[]
}

/* ── Chat protocol (/api/assistants/chat) ── */

export interface ChatToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }

/** The conversation the browser keeps (lib/assistants/history.ts) and sends back each turn. */
/**
 * A file attached to a user message, already converted by
 * /api/assistants/attachments (never stored on the server): extracted text,
 * an image (data URL, kept in this tab only — dropped from the stored
 * history), or a note that the content is no longer available.
 */
export interface ChatAttachment {
  name: string
  mime_type: string
  size: number
  kind: 'text' | 'image' | 'unavailable'
  text?: string
  data_url?: string
  /** How it was read ("Text of a PDF, truncated at 60,000 characters", "BPMN process: 7 tasks…"). */
  note?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | null
  /** user messages: files attached to it. */
  attachments?: ChatAttachment[]
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  name?: string
}

export interface DesignerContext {
  /** Which builder the person is in. */
  area: 'workflow' | 'form' | 'data' | 'decision_table' | 'extensibility' | 'general' | 'report' | 'agent' | 'integration' | 'email_template' | 'page'
  /** The open item (workflow id, form id, table id…). */
  item_id?: string | null
  item_name?: string | null
  /** The editor holds unsaved changes (a write would reload it). */
  dirty?: boolean
  /** A short outline of the open item (e.g. the form designer's fields), as data. */
  summary?: string | null
}

/** Where the person is (for the model and the panel's "Looking at" chip). */
export interface ScreenInfo {
  /** The chip text, e.g. "Workflow “Purchase request”". */
  label: string
  path?: string | null
}

/** The admin page the person is on (settings, team, roles…), for starters and the model's context. */
export const ADMIN_AREAS = ['team', 'roles', 'org', 'theme', 'retention', 'email_templates', 'sign_in_page', 'integrations', 'usage', 'activity', 'invitations', 'settings'] as const
export type AdminArea = (typeof ADMIN_AREAS)[number]

export interface ChatRequest {
  /** Ignored (the first release sent one per assistant): tools follow the screen and permissions. */
  capability?: AssistantCapability | null
  messages: ChatMessage[]
  context?: {
    form_id?: string | null
    task_id?: string | null
    form?: FormSnapshot | null
    designer?: DesignerContext | null
    screen?: ScreenInfo | null
    /** The admin page on screen (null elsewhere). */
    admin?: { area: AdminArea } | null
  }
  /** The person's decision on a write the Agent asked to make. */
  decision?: { tool_call_id: string; approved: boolean } | null
}

export interface ProposedValue {
  key: string
  label: string
  current: unknown
  proposed: unknown
  /** The value shown to people (option labels, Yes / No). */
  display: string
  reason?: string
}

export interface ConfirmCard {
  tool_call_id: string
  tool: string
  title: string
  /** Bullet lines: what will be created / changed. */
  lines: string[]
  warnings: string[]
  /** A table preview (data rows to create / update / delete): the first rows and the total. */
  preview?: { columns: string[]; rows: string[][]; total: number; caption?: string } | null
  /** A destructive change: a red button labelled `confirm_label`. */
  danger?: boolean
  confirm_label?: string
  /** The person must type this text to confirm (bulk deletes). */
  typed_confirm?: string
}

/** One answer button: its label, the reply sent as the person's message, an optional hint under it. */
export interface ChoiceOption { label: string; reply: string; description?: string }

export type AssistantEvent =
  | { type: 'delta'; text: string }
  | { type: 'delta_reset' }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; label: string }
  | { type: 'proposal'; id: string; values: ProposedValue[]; skipped: Array<{ key: string; reason: string }> }
  | { type: 'draft'; id: string; kind: 'comment' | 'outcome_note'; text: string }
  | { type: 'outcome_suggestion'; id: string; outcome: string; reason: string }
  | { type: 'confirm'; card: ConfirmCard }
  /** A question shown as answer buttons (ask_user, ask_where_to_build): the click is the person's next message. */
  | { type: 'choice'; id: string; question: string; options: ChoiceOption[]; allow_other?: boolean; multi?: boolean }
  | { type: 'changed'; kind: string; id: string | null; title: string; href: string | null; action: 'created' | 'updated' | 'deleted' }
  | { type: 'messages'; messages: ChatMessage[] }
  | { type: 'done'; status: 'completed' | 'awaiting_confirmation' }
  | { type: 'error'; error: string; code?: string }
  /** The turn's background job (lib/assistants/background.ts): the panel can move it to the background or stop it. */
  | { type: 'job'; id: string; turn_id: string }

/** Designer tools that change something (confirmation first, drafts only). */
export const DESIGNER_WRITE_TOOLS = [
  'workflows_create', 'workflows_update',
  'forms_create', 'forms_update',
  'data_tables_create', 'data_tables_update_schema',
  'decision_tables_create', 'decision_tables_update',
  'workflow_activities_create', 'workflow_activities_update',
  'form_controls_create', 'form_controls_update',
  'data_rows_create', 'data_rows_update', 'data_rows_bulk_delete',
  'reports_create', 'reports_update',
  'agents_create', 'agents_update',
  'email_templates_create', 'email_templates_update',
  'integrations_test',
] as const

/** Designer tools that only read. */
export const DESIGNER_READ_TOOLS = [
  'workflows_catalog', 'workflows_list', 'workflows_get', 'workflows_get_definition', 'workflows_preflight', 'workflows_validate',
  'forms_list', 'forms_get', 'forms_check_accessibility',
  'data_tables_list', 'data_tables_get', 'data_rows_query', 'data_rows_get',
  'reports_list', 'reports_get', 'reports_preview', 'reports_sources_list', 'reports_source_get',
  'agents_list', 'agents_get',
  'integrations_list', 'integrations_get', 'connectors_list', 'connectors_get',
  'email_templates_list', 'email_templates_get', 'email_templates_preview',
  'decision_tables_list', 'decision_tables_get', 'decision_tables_test',
  'workflow_activities_list', 'workflow_activities_get',
  'form_controls_list', 'form_controls_get',
] as const

/** Starter prompts per builder area. */
export const DESIGNER_STARTERS: Record<DesignerContext['area'], string[]> = {
  workflow: ['Explain what this workflow does', 'Add an approval step after the first user task', 'Check this workflow for problems'],
  form: ['Add a phone field with validation', 'Suggest fields for an expense claim form', 'Check this form for accessibility issues'],
  data: ['Create a table for tracking equipment loans', 'Add a status column with choices', 'Explain this table\'s columns'],
  decision_table: ['Create a discount decision table by order size', 'Explain the rules in this table', 'Test this table with a sample input'],
  extensibility: ['Create a custom action that formats a phone number', 'List the custom form controls', 'Explain what this action does'],
  general: ['Build a leave request process with a manager approval', 'List my workflows', 'Create a form for IT access requests'],
  report: ['Add a chart of requests by department', 'Why is this total different from last week?', 'Add a filter for this month'],
  agent: ['Write instructions for an agent that triages support emails', 'Which tools does this agent need?', 'Explain what this agent can do'],
  integration: ['Explain this connection', 'Test this connection', 'Which workflows could use this?'],
  email_template: ['Draft a friendly approval email', 'Make this email shorter', 'Add the request reference to the subject'],
  page: ['What can you help me with here?', 'Explain this page', 'List my workflows'],
}

/** Starter prompts per admin page. */
export const ADMIN_STARTERS: Record<AdminArea, string[]> = {
  team: ['Invite sam@example.com as a Member and add them to Finance', 'Why can\'t Chloe see Reports?', 'Set Priya as Tom\'s manager'],
  roles: ['Who can approve purchase requests?', 'Explain what the Manager role can do', 'Create a Finance reviewer role that can view reports and data'],
  org: ['Who reports to Priya?', 'Set Priya as Tom\'s manager', 'Import the attached org chart CSV (preview first)'],
  theme: ['Explain the current theme settings', 'Apply a calm blue theme preset', 'Which theme colours fail contrast?'],
  retention: ['Which retention policies are in use?', 'Create a policy that deletes submissions after 2 years', 'Which forms are on legal hold?'],
  email_templates: ['Explain this page', 'List the email templates', 'Draft a friendly approval email'],
  sign_in_page: ['Explain the form sign-in page settings', 'Use the split design with our accent colour', 'What do visitors see before signing in?'],
  integrations: ['Is log export healthy?', 'When did directory sync last run?', 'How do I rotate the SCIM token?'],
  usage: ['How much has the Agent cost this month?', 'Who uses the Agent the most?', 'Show AI agent costs by agent'],
  activity: ['What changed in the last 24 hours?', 'Who changed roles this week?', 'Any failed runs or SLA breaches?'],
  invitations: ['Which invitations are still pending?', 'Invite sam@example.com as a Member', 'Explain the roles I can invite as'],
  settings: ['Explain the settings on this page', 'Is the workspace healthy?', 'Who has access to Settings?'],
}

export const FORM_STARTERS = ['Help me fill this in', 'What does this form need from me?', 'Why can\'t I submit?']
export const TASK_STARTERS = ['Summarise this task', 'What are my options here?', 'Draft a comment for the requester']
export const PROCESS_STARTERS = ['Build everything for the attached process', 'Build a leave request process: employee submits, manager approves, HR records it', 'Plan the forms and workflow for this process before building']
export const GENERAL_STARTERS = ['What can you help me with here?', 'List my workflows', 'Explain what this page is for']
