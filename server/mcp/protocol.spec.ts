import { describe, expect, it, vi } from 'vitest'
import { handleRpc, type ToolRegistry } from './protocol.js'

const echo: ToolRegistry = {
  list: () => [{ name: 'echo', description: 'Echoes', inputSchema: { type: 'object' } }],
  call: async (name, args) => {
    if (name === 'boom') throw new Error('database password leaked here')
    return { content: [{ type: 'text', text: JSON.stringify(args) }] }
  },
  has: name => name === 'echo' || name === 'boom',
}

const rpc = (method: string, params?: unknown) =>
  handleRpc({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }, echo)

describe('handleRpc (D-38)', () => {
  it('answers initialize with the client’s protocol version when it is one we know', async () => {
    expect(await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code' } }))
      .toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'habit-tracker', version: '1.0.0' },
          instructions: expect.any(String),
        },
      })
  })

  it('offers its own version for one it does not know', async () => {
    const reply = await rpc('initialize', { protocolVersion: '1999-01-01' }) as { result: { protocolVersion: string } }
    expect(reply.result.protocolVersion).toBe('2025-06-18')
  })

  it('returns nothing for a notification', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, echo)).toBeNull()
  })

  it('answers ping', async () => {
    expect(await rpc('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
  })

  it('lists the tools', async () => {
    expect(await rpc('tools/list')).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: echo.list() } })
  })

  it('calls a tool with its arguments', async () => {
    expect(await rpc('tools/call', { name: 'echo', arguments: { a: 1 } }))
      .toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"a":1}' }] } })
  })

  it('treats missing arguments as none', async () => {
    const reply = await rpc('tools/call', { name: 'echo' }) as { result: { content: { text: string }[] } }
    expect(reply.result.content[0]!.text).toBe('{}')
  })

  it('rejects an unknown tool as invalid params', async () => {
    expect(await rpc('tools/call', { name: 'nope' }))
      .toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown tool: nope' } })
  })

  it('rejects an unknown method', async () => {
    expect(await rpc('resources/list'))
      .toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found: resources/list' } })
  })

  it('rejects a batch, which this server does not accept', async () => {
    expect(await handleRpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }], echo))
      .toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })
  })

  it('rejects something that is not JSON-RPC 2.0', async () => {
    expect(await handleRpc({ id: 3, method: 'ping' }, echo))
      .toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32600, message: 'Invalid Request' } })
  })

  it('hides what went wrong inside a tool behind a generic error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await rpc('tools/call', { name: 'boom' }))
      .toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } })
    log.mockRestore()
  })
})
