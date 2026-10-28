import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_TIMEOUT_MS = 30_000

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false
    if (host === 'metadata.google.internal') return false
    const parts = host.split('.').map(Number)
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return false
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false
      if (parts[0] === 192 && parts[1] === 168) return false
      if (parts[0] === 169 && parts[1] === 254) return false
    }
    return true
  } catch { return false }
}

/** Execute a tool on a remote MCP server */
export async function executeMcpTool(
  supabase: any,
  mcpServerId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<any> {
  const { data: server } = await supabase.from('mcp_servers')
    .select('id, url, auth_type, auth_config').eq('id', mcpServerId).single()
  if (!server) return { error: 'MCP server not found' }
  if (!isUrlSafe(server.url)) return { error: 'MCP server URL is not allowed (private network)' }

  let client: Client | null = null
  try {
    const headers: Record<string, string> = {}
    if (server.auth_type === 'bearer' && server.auth_config?.token) {
      headers['Authorization'] = `Bearer ${server.auth_config.token}`
    } else if (server.auth_type === 'api_key' && server.auth_config?.key_name) {
      headers[server.auth_config.key_name] = server.auth_config.key_value ?? ''
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
