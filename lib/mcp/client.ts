import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_TIMEOUT_MS = 30_000

/** Execute a tool on a remote MCP server */
export async function executeMcpTool(
  supabase: any,
  mcpServerId: string,
  toolName: string,
  args: Record<string, any>,
  options: { tenantId: string },
): Promise<any> {
  // Scoped to the agent's tenant: an agent can only call its own workspace's servers.
  const { data: server } = await supabase.from('mcp_servers')
    .select('id, url, auth_type, auth_config, is_active').eq('id', mcpServerId).eq('tenant_id', options.tenantId).maybeSingle()
  if (!server) return { error: 'MCP server not found' }
  if (server.is_active === false) return { error: 'MCP server is inactive' }
  try {
    const { assertSafeEgressUrl } = await import('@/lib/egress-guard')
    await assertSafeEgressUrl(server.url)
  } catch (err: any) {
    return { error: err?.message ?? 'MCP server URL is not allowed' }
  }

  let client: Client | null = null
  try {
    const { decryptSensitiveFields } = await import('@/lib/secret-fields')
    const auth = decryptSensitiveFields(server.auth_config ?? {}) as Record<string, any>
    const headers: Record<string, string> = {}
    if (server.auth_type === 'bearer' && auth?.token) {
      headers['Authorization'] = `Bearer ${auth.token}`
    } else if (server.auth_type === 'api_key' && auth?.key_name) {
      headers[auth.key_name] = auth.key_value ?? ''
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(server.url),
      { requestInit: { headers, signal: AbortSignal.timeout(MCP_TIMEOUT_MS) } },
    )
    client = new Client({ name: 'usertasks-agent', version: '1.0.0' })
    await client.connect(transport)

    const result = await client.callTool({ name: toolName, arguments: args })

    const textContent = (result.content as any[])
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')

    try { return JSON.parse(textContent) } catch { return { result: textContent } }
  } catch (err: any) {
    return { error: `MCP tool call failed: ${err.message}` }
  } finally {
    try { await client?.close() } catch {}
  }
}
