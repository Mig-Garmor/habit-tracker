import { Hono } from 'hono'
import { bearerOk } from '../mcp/auth.js'
import { handleRpc, type ToolRegistry } from '../mcp/protocol.js'

/**
 * `POST /api/mcp` — stateless MCP over HTTP (D-38). Mounted before the session
 * middleware: the bearer token is the only way in, and a session cookie alone
 * must never drive tools (D-39).
 */
export function mcpRoutes(tools: ToolRegistry) {
  const routes = new Hono()

  routes.post('/', async c => {
    // Claude Code sends no Origin; a browser always does. Refusing any page's
    // request closes DNS-rebinding and drive-by tricks before the token is
    // even looked at, as the MCP transport spec asks of servers.
    if (c.req.header('origin')) return c.json({ error: 'Not allowed from a web page' }, 403)

    if (!bearerOk(c.req.header('authorization'), process.env.MCP_TOKEN)) {
      c.header('WWW-Authenticate', 'Bearer')
      return c.json({ error: 'Not authorised' }, 401)
    }

    let message: unknown
    try {
      message = JSON.parse(await c.req.text())
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
    }

    const reply = await handleRpc(message, tools)
    if (reply === null) return c.body(null, 202)
    return c.json(reply)
  })

  // No server-initiated stream and no sessions to end.
  routes.on(['GET', 'DELETE'], '/', c => {
    c.header('Allow', 'POST')
    return c.json({ error: 'Method not allowed' }, 405)
  })

  return routes
}
