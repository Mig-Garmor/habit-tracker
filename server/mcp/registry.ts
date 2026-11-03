import type { ToolDefinition, ToolRegistry, ToolResult } from './protocol.js'

export interface Tool {
  definition: ToolDefinition
  run(args: Record<string, unknown>): Promise<ToolResult>
}

export function createRegistry(tools: Tool[]): ToolRegistry {
  const byName = new Map(tools.map(tool => [tool.definition.name, tool]))
  return {
    list: () => tools.map(tool => tool.definition),
    has: name => byName.has(name),
    call: (name, args) => byName.get(name)!.run(args),
  }
}
