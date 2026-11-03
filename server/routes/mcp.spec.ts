import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../test/pg-harness.js'
import { signedCookieHeader, TEST_EMAIL, TEST_SESSION_SECRET } from '../test/session-cookie.js'

const holder = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('../db/client', () => ({
  get db() {
    return holder.db
  },
  isDatabaseConfigured: () => true,
  databaseStatus: () => Promise.resolve('reachable'),
}))

const TOKEN = 't'.repeat(43)

let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let closeTestDb: () => Promise<void>
let cookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SESSION_SECRET
  process.env.ALLOWED_EMAILS = TEST_EMAIL
  process.env.MCP_TOKEN = TOKEN
  cookie = await signedCookieHeader()
  const { db, close } = await createTestDb()
  holder.db = db
  closeTestDb = close
  app = (await import('../app.js')).createApp()
})

afterAll(async () => {
  delete process.env.MCP_TOKEN
  await closeTestDb()
})

function post(body: string, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return app.request('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body,
  })
}

const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })

describe('POST /api/mcp', () => {
  it('answers a request with the token', async () => {
    const response = await post(ping)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
  })

  it('accepts a notification with 202 and no body', async () => {
    const response = await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('says why it cannot read a body that is not JSON', async () => {
    const response = await post('{not json')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  })
})

describe('who may call it (D-39)', () => {
  it('refuses a wrong token', async () => {
    const response = await post(ping, { authorization: `Bearer ${'w'.repeat(43)}` })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
  })

  it('refuses a signed-in browser that has no token', async () => {
    expect((await post(ping, { cookie })).status).toBe(401)
  })

  it('refuses anything sent from a web page, token or not', async () => {
    expect((await post(ping, { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' })).status).toBe(403)
  })

  it('stays shut when no token is configured', async () => {
    delete process.env.MCP_TOKEN
    try {
      expect((await post(ping)).status).toBe(401)
    } finally {
      process.env.MCP_TOKEN = TOKEN
    }
  })
})

describe('other methods', () => {
  it('has no server stream to GET', async () => {
    const response = await app.request('/api/mcp', { headers: { authorization: `Bearer ${TOKEN}` } })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('has no session to DELETE', async () => {
    expect((await app.request('/api/mcp', { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405)
  })
})
