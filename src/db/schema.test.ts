import { afterEach, describe, expect, it } from 'vitest'
import { BACKUP_SCHEMA_VERSION, TABLE_NAMES } from './backupSchema'
import { AppDB, DB_NAME, DB_SCHEMA_VERSION, DB_TABLES } from './schema'

let db: AppDB | null = null

afterEach(async () => {
  if (db) {
    db.close()
    await db.delete()
    db = null
  }
})

describe('AppDB schema', () => {
  it('declares exactly the contract tables', async () => {
    db = new AppDB(`schema-test-${DB_TABLES.length}`)
    await db.open()
    expect(db.tables.map((t) => t.name).sort()).toEqual([...DB_TABLES].sort())
  })

  it('lists the same tables, in the same order, as the backup format', () => {
    expect([...DB_TABLES]).toEqual([...TABLE_NAMES])
    expect(DB_SCHEMA_VERSION).toBe(BACKUP_SCHEMA_VERSION)
  })

  it('starts a new database with only the settings row', async () => {
    db = new AppDB('schema-test-seed')
    await db.open()
    expect(await db.settings.toArray()).toEqual([{ id: 'singleton', values: {}, updatedAt: 0 }])
    expect(await db.activities.count()).toBe(0)
  })

  it('uses its own database name (both apps share the github.io origin)', () => {
    expect(DB_NAME).toBe('routine-applet')
  })
})
