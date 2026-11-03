/**
 * The MCP server's JSON-RPC layer, stateless (D-38): one message in, at most
 * one reply out. Knows nothing about habits; tools come in as a registry.
 */

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolResult {
  content: { type: 'text', text: string }[]
  structuredContent?: unknown
  /** A tool-level failure Claude should read and act on, not a protocol fault. */
  isError?: boolean
}

export interface ToolRegistry {
  list(): ToolDefinition[]
  has(name: string): boolean
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>
}

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const
const LATEST = PROTOCOL_VERSIONS[0]

const INSTRUCTIONS = [
  'The user\'s habit tracker. Morning habits are work routines, evening habits are personal goals.',
  'Dates are YYYY-MM-DD in the user\'s time zone and default to today.',
  'Habits are named, not numbered: pass the name you see in get_today.',
].join(' ')

type Id = string | number | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const reply = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result })
const fail = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

export async function handleRpc(message: unknown, tools: ToolRegistry): Promise<object | null> {
  // Batches are optional in MCP and nothing here needs one.
  if (!isRecord(message)) return fail(null, -32600, 'Invalid Request')

  const id = (typeof message.id === 'string' || typeof message.id === 'number') ? message.id : null
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return fail(id, -32600, 'Invalid Request')

  // A notification is never answered, whatever it is.
  if (!('id' in message)) return null

  const params = isRecord(message.params) ? message.params : {}

  switch (message.method) {
    case 'initialize': {
      const asked = params.protocolVersion
      const protocolVersion = PROTOCOL_VERSIONS.find(version => version === asked) ?? LATEST
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'habit-tracker', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: tools.list() })
    case 'tools/call': {
      const name = params.name
      if (typeof name !== 'string' || !tools.has(name)) {
        return fail(id, -32602, `Unknown tool: ${String(name)}`)
      }
      const args = isRecord(params.arguments) ? params.arguments : {}
      try {
        return reply(id, await tools.call(name, args))
      } catch (err) {
        // Message and stack only, never the object: a failed database call
        // can carry the connection string in its properties.
        const error = err instanceof Error ? err : new Error(String(err))
        console.error(error.message, error.stack)
        return fail(id, -32603, 'Internal error')
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${message.method}`)
  }
}
