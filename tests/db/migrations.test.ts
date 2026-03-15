import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'

function createTestKnex(): Knex {
  return KnexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, '../../src/db/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  })
}

describe('migrations', () => {
  let db: Knex

  beforeEach(() => {
    db = createTestKnex()
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('runs all migrations from scratch without error', async () => {
    await expect(db.migrate.latest()).resolves.not.toThrow()
  })

  it('creates all four tables', async () => {
    await db.migrate.latest()
    const tables = ['products', 'feature_definitions', 'feature_rules', 'config_revisions']
    for (const table of tables) {
      expect(await db.schema.hasTable(table)).toBe(true)
    }
  })

  it('is idempotent: second migrate.latest() applies no new batch', async () => {
    await db.migrate.latest()
    // Knex 3.x returns [nextBatchNumber, appliedList] from migrate.latest().
    // When nothing is pending, appliedList is empty; nextBatchNumber is NOT 0.
    // The idempotency guarantee is that no new migration files were applied.
    const [, log] = await db.migrate.latest()
    expect(log).toHaveLength(0)
  })

  it('enforces unique constraint on (product_id, feature_key) in feature_definitions', async () => {
    await db.migrate.latest()
    await db('products').insert({ id: 1, name: 'test', ttl_seconds: 3600, current_revision: 0 })
    await db('feature_definitions').insert({
      product_id: 1,
      feature_key: 'chat',
      default_entry_json: '{}',
      status: 'active',
    })
    await expect(
      db('feature_definitions').insert({
        product_id: 1,
        feature_key: 'chat',
        default_entry_json: '{}',
        status: 'active',
      })
    ).rejects.toThrow()
  })

  it('allows same feature_key for different product_ids in feature_definitions', async () => {
    await db.migrate.latest()
    await db('products').insert([
      { id: 1, name: 'product-a', ttl_seconds: 3600, current_revision: 0 },
      { id: 2, name: 'product-b', ttl_seconds: 3600, current_revision: 0 },
    ])
    await expect(
      db('feature_definitions').insert([
        { product_id: 1, feature_key: 'chat', default_entry_json: '{}', status: 'active' },
        { product_id: 2, feature_key: 'chat', default_entry_json: '{}', status: 'active' },
      ])
    ).resolves.not.toThrow()
  })
})
