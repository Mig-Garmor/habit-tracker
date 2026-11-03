import { createRegistry, type Tool } from './registry.js'

/** Every tool the habit tracker offers Claude. */
export const TOOLS: Tool[] = []

export const habitTools = createRegistry(TOOLS)
