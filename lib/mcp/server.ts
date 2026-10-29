import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { getParseErrorMessage, objectFromShape, safeParseAsync, type AnyObjectSchema, type ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { registerTaskTools } from './tools/tasks'
import { registerWorkflowTools } from './tools/workflows'
import { registerAgentTools } from './tools/agents'
import { registerDataTools } from './tools/data'
import { registerReportTools } from './tools/reports'
import { registerIntegrationTools } from './tools/integrations'
import { registerGovernanceTools } from './tools/governance'
import { registerApiKeyTools } from './tools/api-keys'
import { registerObservabilityTools } from './tools/observability'
import { registerDecisionTableTools } from './tools/decision-tables'
import { registerExtensibilityTools } from './tools/extensibility'
import { registerEmailTemplateTools } from './tools/email-templates'
import { registerFormTools } from './tools/forms'
import { registerFileTools } from './tools/files'
import { registerRetentionTools } from './tools/retention'
import { registerWebhookTools } from './tools/webhooks'
import { registerLogDestinationTools } from './tools/log-destinations'
import { registerDirectorySyncTools } from './tools/directory-sync'
import { registerWorkspaceThemeTools } from './tools/workspace-theme'
import { registerConfigTools } from './tools/config'
import { registerPackageTools } from './tools/packages'
import { checkToolPermission, auditToolCall } from './authz'

export interface McpContext {
  tenantId: string
  supabase: any
  actingUserId?: string | null
  keyType?: 'tenant' | 'user'
  /** Resolved permission keys for this API key. Undefined disables per-tool gating (standalone/test). */
  permissions?: string[]
  scopes?: {
    workflow_ids: string[]
    table_ids: string[]
  }
  /** Granted OAuth scopes when the caller authenticated with an OAuth access token. */
  oauthScopes?: string[]
  /** User who created the API key / OAuth client (attribution for tenant keys). */
  credentialOwnerId?: string | null
}

export interface McpToolDef {
  name: string
  description: string
  category: string
  schema: Record<string, z.ZodTypeAny>
  handler: (args: any) => Promise<any>
}

type ToolRegistrar = (server: any, ctx: McpContext) => void

const TOOL_REGISTRARS: Array<{ label: string; register: ToolRegistrar }> = [
  { label: 'tasks', register: registerTaskTools },
  { label: 'workflows', register: registerWorkflowTools },
  { label: 'agents', register: registerAgentTools },
  { label: 'data', register: registerDataTools },
  { label: 'reports', register: registerReportTools },
  { label: 'integrations', register: registerIntegrationTools },
  { label: 'governance', register: registerGovernanceTools },
  { label: 'api_keys', register: registerApiKeyTools },
  { label: 'observability', register: registerObservabilityTools },
  { label: 'decision_tables', register: registerDecisionTableTools },
  { label: 'extensibility', register: registerExtensibilityTools },
  { label: 'email_templates', register: registerEmailTemplateTools },
  { label: 'forms', register: registerFormTools },
  { label: 'files', register: registerFileTools },
  { label: 'retention', register: registerRetentionTools },
  { label: 'webhooks', register: registerWebhookTools },
  { label: 'log_destinations', register: registerLogDestinationTools },
  { label: 'directory_sync', register: registerDirectorySyncTools },
  { label: 'workspace_theme', register: registerWorkspaceThemeTools },
  { label: 'config', register: registerConfigTools },
  { label: 'packages', register: registerPackageTools },
]

export const MCP_TOOL_CATEGORIES = TOOL_REGISTRARS.map(({ label }) => label)

function zodToJsonSchema(val: z.ZodTypeAny): Record<string, any> {
  if (val instanceof z.ZodOptional || val instanceof z.ZodNullable) {
    return zodToJsonSchema((val as any)._def.innerType)
  }
  if (val instanceof z.ZodDefault) {
    return zodToJsonSchema((val as any)._def.innerType)
  }
  if (val instanceof z.ZodEnum) {
    const options =
      (Array.isArray((val as any).options) && (val as any).options)
      || (Array.isArray((val as any)._def?.values) && (val as any)._def.values)
      || (Array.isArray((val as any)._def?.entries) ? (val as any)._def.entries : null)
      || ((val as any)._def?.entries && typeof (val as any)._def.entries === 'object'
        ? Object.values((val as any)._def.entries)
        : [])
    return { type: 'string', enum: [...options] }
  }
  if (val instanceof z.ZodBoolean) return { type: 'boolean' }
  if (val instanceof z.ZodNumber) return { type: 'number' }
  if (val instanceof z.ZodString) return { type: 'string' }
  if (val instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema((val as any)._def.type) }
  }
  if (val instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: true }
  }
  if (val instanceof z.ZodObject) {
    const shape = (val as any).shape
    const properties: Record<string, any> = {}
    const required: string[] = []
    for (const [key, child] of Object.entries(shape)) {
      const childSchema = zodToJsonSchema(child as z.ZodTypeAny)
      childSchema.description = (child as any)._def?.description ?? key
      properties[key] = childSchema
      const isOptional = (child as any).isOptional?.() || child instanceof z.ZodOptional
      if (!isOptional) required.push(key)
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) }
  }
  return { type: 'string' }
}

// Tool input schemas don't depend on the caller, so their JSON forms are built
// once per process (keyed by tool name) instead of on every request.
const standaloneSchemaCache = new Map<string, Record<string, any>>()

/** JSON Schema used by the info endpoint / getRegisteredTools (not the MCP wire format). */
function standaloneInputSchema(name: string, schema: Record<string, z.ZodTypeAny>): Record<string, any> {
  const cached = standaloneSchemaCache.get(name)
  if (cached) return cached
  const properties: Record<string, any> = {}
  const required: string[] = []
  for (const [key, val] of Object.entries(schema)) {
    const isOptional = val.isOptional?.() || val instanceof z.ZodOptional
    properties[key] = {
      ...zodToJsonSchema(val),
      description: (val as any)._def?.description ?? key,
    }
    if (!isOptional) required.push(key)
  }
  const built = { type: 'object', properties, required }
  standaloneSchemaCache.set(name, built)
  return built
}

/**
 * Adapter that wraps the SDK McpServer with the same .tool() API
 * that all existing tool modules use. This lets us upgrade the transport
 * without rewriting every tool registration file.
 */
export class McpToolServer {
  private tools = new Map<string, McpToolDef>()
  private sdkServer: McpServer | null = null
  private ctx: McpContext | null = null
  private registrationErrors: string[] = []
  private currentCategory = 'uncategorized'

  constructor(sdkServer?: McpServer, ctx?: McpContext) {
    this.sdkServer = sdkServer ?? null
    this.ctx = ctx ?? null
  }

  tool(name: string, description: string, schema: Record<string, z.ZodTypeAny>, handler: (args: any) => Promise<any>) {
    // Central authorization + audit wrapper — applies to every tool uniformly.
    const ctx = this.ctx
    const guardedHandler = async (args: any) => {
      if (ctx) {
        const denied = checkToolPermission(ctx, name)
        if (denied) return denied
      }
      const result = await handler(args)
      if (ctx) auditToolCall(ctx, name, args, result)
      return result
    }

    this.tools.set(name, {
      name,
      description,
      category: this.currentCategory,
      schema,
      handler: guardedHandler,
    })

    // Also register on the SDK server if available
    if (this.sdkServer) {
      this.sdkServer.tool(name, description, schema, async (args) => {
        return guardedHandler(args)
      })
    }
  }

  /** Guarded handler for a tool (authorization + audit applied), if registered. */
  getHandler(name: string): McpToolDef['handler'] | undefined {
    return this.tools.get(name)?.handler
  }

  /** Raw zod shapes by tool name (process-level catalog input). */
  getToolShapes(): Array<{ name: string; description: string; schema: Record<string, z.ZodTypeAny> }> {
    return [...this.tools.values()].map(({ name, description, schema }) => ({ name, description, schema }))
  }

  getRegisteredTools() {
    return [...this.tools.values()].map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      inputSchema: standaloneInputSchema(t.name, t.schema),
    }))
  }

  setRegistrationCategory(category: string) {
    this.currentCategory = category
  }

  addRegistrationError(message: string) {
    this.registrationErrors.push(message)
  }

  getRegistrationErrors() {
    return [...this.registrationErrors]
  }

  async callTool(name: string, args: any) {
    const tool = this.tools.get(name)
    if (!tool) return mcpErr(`Unknown tool: ${name}`)
    try {
      return await tool.handler(args)
    } catch (err: any) {
      return mcpErr(`Tool execution failed: ${err?.message ?? 'Unknown error'}`)
    }
  }
}

function registerToolModules(server: McpToolServer, ctx: McpContext) {
  for (const { label, register } of TOOL_REGISTRARS) {
    try {
      server.setRegistrationCategory(label)
      register(server as any, ctx)
    } catch (error: any) {
      const message = `[mcp] Failed to register ${label} tools: ${error?.message ?? 'Unknown error'}`
      console.error(message, error)
      server.addRegistrationError(message)
    }
  }
  server.setRegistrationCategory('uncategorized')
}

/** Register all tools on an SDK McpServer */
export function registerAllTools(sdkServer: McpServer, ctx: McpContext) {
  const adapter = new McpToolServer(sdkServer, ctx)
  registerToolModules(adapter, ctx)
  return adapter
}

/** Create a standalone server (for non-transport use) */
export function createMcpServer(ctx: McpContext): McpToolServer {
  const server = new McpToolServer(undefined, ctx)
  registerToolModules(server, ctx)
  return server
}

/* ── Process-level tool catalog (MCP transport) ──────────────────────────── */

interface ToolCatalog {
  /** tools/list result, in the exact shape the SDK McpServer produced. */
  tools: Tool[]
  /** Input validators (z.object of each tool's raw shape), as McpServer builds them. */
  inputSchemas: Map<string, AnyObjectSchema>
}

let toolCatalog: ToolCatalog | null = null
let toolCatalogBuilds = 0

/**
 * Tool definitions and their JSON Schemas, built once per process. Tool
 * modules close over the caller's context at registration, but their names,
 * descriptions and input schemas do not depend on it, so a registration with
 * a placeholder context yields the shared catalog.
 */
export function getMcpToolCatalog(): ToolCatalog {
  if (toolCatalog) return toolCatalog
  const server = new McpToolServer(undefined, undefined)
  registerToolModules(server, { tenantId: '', supabase: null })
  const tools: Tool[] = []
  const inputSchemas = new Map<string, AnyObjectSchema>()
  for (const { name, description, schema } of server.getToolShapes()) {
    const inputSchema = objectFromShape(schema as ZodRawShapeCompat)
    inputSchemas.set(name, inputSchema)
    tools.push({
      name,
      title: undefined,
      description,
      inputSchema: toJsonSchemaCompat(inputSchema, { strictUnions: true, pipeStrategy: 'input' }) as Tool['inputSchema'],
      annotations: undefined,
      execution: { taskSupport: 'forbidden' },
      _meta: undefined,
    } as Tool)
  }
  toolCatalogBuilds += 1
  toolCatalog = { tools, inputSchemas }
  return toolCatalog
}

/** Test hook: how many times the process-level catalog was built. */
export function mcpToolCatalogBuildCount(): number {
  return toolCatalogBuilds
}

// Handlers bound to a caller context, reused while the same credential (same
// tenant, identity, permissions, scopes and shared client) keeps calling.
const CONTEXT_CACHE_MAX = 200
const contextServers = new Map<string, { supabase: unknown; server: McpToolServer }>()

function contextFingerprint(ctx: McpContext): string {
  const { supabase: _client, ...rest } = ctx
  void _client
  return JSON.stringify(rest, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value)
}

/** Tool server bound to `ctx`; reused for an identical context (and client). */
export function getContextToolServer(ctx: McpContext): McpToolServer {
  const key = contextFingerprint(ctx)
  const hit = contextServers.get(key)
  if (hit && hit.supabase === ctx.supabase) {
    contextServers.delete(key)
    contextServers.set(key, hit)
    return hit.server
  }
  const server = createMcpServer(ctx)
  contextServers.delete(key)
  contextServers.set(key, { supabase: ctx.supabase, server })
  while (contextServers.size > CONTEXT_CACHE_MAX) {
    const oldest = contextServers.keys().next().value
    if (oldest === undefined) break
    contextServers.delete(oldest)
  }
  return server
}

/**
 * Low-level MCP protocol server for one request: tools/list answers from the
 * process-level catalog and tools/call validates against the cached schema,
 * then runs the context-bound handler. Mirrors McpServer's tool handling
 * (same list shape, same validation and error results).
 */
export function createMcpProtocolServer(ctx: McpContext): Server {
  const catalog = getMcpToolCatalog()
  const server = new Server({ name: 'UserTasks', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
  let bound: McpToolServer | null = null

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: catalog.tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const name = request.params.name
      const inputSchema = catalog.inputSchemas.get(name)
      bound ??= getContextToolServer(ctx)
      const handler = bound.getHandler(name)
      if (!inputSchema || !handler) {
        throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found`)
      }
      const parsed = await safeParseAsync(inputSchema, request.params.arguments)
      if (!parsed.success) {
        const error = 'error' in parsed ? parsed.error : 'Unknown error'
        throw new McpError(ErrorCode.InvalidParams, `Input validation error: Invalid arguments for tool ${name}: ${getParseErrorMessage(error)}`)
      }
      return await handler(parsed.data)
    } catch (error) {
      return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }
    }
  })
  return server
}

/** Format a successful MCP tool response */
export function mcpOk(data: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

/** Format an error MCP tool response */
export function mcpErr(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const }
}
