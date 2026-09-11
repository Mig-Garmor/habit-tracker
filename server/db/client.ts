import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

/** Gitignored — your real data. Override with DATABASE_PATH for scripts/tests. */
export const DB_PATH = process.env.DATABASE_PATH ?? resolve(process.cwd(), 'data/habits.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
