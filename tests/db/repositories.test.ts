import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { DefaultProductsRepository } from '../../src/modules/products/repository'
import { DefaultDefinitionsRepository } from '../../src/modules/definitions/repository'
import { DefaultRulesRepository } from '../../src/modules/rules/repository'
import { DefaultRevisionsRepository } from '../../src/modules/revisions/repository'
import { withTransaction } from '../../src/db/transaction'

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

// ─── ProductsRepository ───────────────────────────────────────────────────────

describe('DefaultProductsRepository', () => {
  let db: Knex
  let repo: DefaultProductsRepository

  beforeEach(async () => {
    db = createTestKnex()
    await db.migrate.latest()
    repo = new DefaultProductsRepository(db)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('upsertByName creates a new product and returns it', async () => {
    const product = await repo.upsertByName('elph_nova', 7200)
    expect(product.id).toBeGreaterThan(0)
    expect(product.name).toBe('elph_nova')
    expect(product.ttl_seconds).toBe(7200)
    expect(product.current_revision).toBe(0)
  })

  it('upsertByName returns existing product without creating a duplicate', async () => {
    const first = await repo.upsertByName('elph_nova')
    const second = await repo.upsertByName('elph_nova')
    expect(first.id).toBe(second.id)
    const rows = await db('products').where({ name: 'elph_nova' })
    expect(rows).toHaveLength(1)
  })

  it('findById returns the product', async () => {
    const created = await repo.upsertByName('elph_nova')
    const found = await repo.findById(created.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('elph_nova')
  })

  it('findById returns undefined for unknown id', async () => {
    const result = await repo.findById(9999)
    expect(result).toBeUndefined()
  })

  it('updateRevision advances current_revision when expectedRevision matches', async () => {
    const product = await repo.upsertByName('elph_nova')
    await repo.updateRevision(product.id, 5, 0)
    const updated = await repo.findById(product.id)
    expect(updated!.current_revision).toBe(5)
  })

  it('updateRevision throws on revision conflict', async () => {
    const product = await repo.upsertByName('elph_nova')
    await expect(repo.updateRevision(product.id, 5, 99)).rejects.toThrow(/Revision conflict/)
    const unchanged = await repo.findById(product.id)
    expect(unchanged!.current_revision).toBe(0)
  })

  it('updateManifestHash persists the hash', async () => {
    const product = await repo.upsertByName('elph_nova')
    await repo.updateManifestHash(product.id, 'abc123')
    const updated = await repo.findById(product.id)
    expect(updated!.manifest_hash).toBe('abc123')
  })
})

// ─── DefinitionsRepository ────────────────────────────────────────────────────

describe('DefaultDefinitionsRepository', () => {
  let db: Knex
  let products: DefaultProductsRepository
  let repo: DefaultDefinitionsRepository
  let productId: number

  beforeEach(async () => {
    db = createTestKnex()
    await db.migrate.latest()
    products = new DefaultProductsRepository(db)
    repo = new DefaultDefinitionsRepository(db)
    const p = await products.upsertByName('test_product')
    productId = p.id
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('upsert inserts a new definition and returns it', async () => {
    const row = await repo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"enabled":true}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: null,
      delivery_mode: null,
      manifest_hash: 'hash_v1',
      status: 'active',
    })
    expect(row.id).toBeGreaterThan(0)
    expect(row.feature_key).toBe('chat')
    expect(row.default_entry_json).toBe('{"enabled":true}')
  })

  it('upsert updates an existing definition on conflict', async () => {
    await repo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"enabled":true}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: null,
      delivery_mode: null,
      manifest_hash: 'hash_v1',
      status: 'active',
    })
    const updated = await repo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"enabled":false}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: null,
      delivery_mode: null,
      manifest_hash: 'hash_v2',
      status: 'active',
    })
    expect(updated.default_entry_json).toBe('{"enabled":false}')
    const rows = await db('feature_definitions').where({ product_id: productId, feature_key: 'chat' })
    expect(rows).toHaveLength(1)
  })

  it('findByKey returns the definition', async () => {
    await repo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: null,
      delivery_mode: null,
      manifest_hash: 'hash_v1',
      status: 'active',
    })
    const found = await repo.findByKey(productId, 'chat')
    expect(found).toBeDefined()
    expect(found!.feature_key).toBe('chat')
  })

  it('findByKey returns undefined for unknown key', async () => {
    const result = await repo.findByKey(productId, 'nonexistent')
    expect(result).toBeUndefined()
  })

  it('listActive returns only active definitions', async () => {
    await repo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: null,
      delivery_mode: null,
      manifest_hash: 'hash_v1',
      status: 'active',
    })
    await repo.upsert({
      product_id: productId,
      feature_key: 'video',
      default_entry_json: '{}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: null,
      delivery_mode: null,
      manifest_hash: 'hash_v1',
      status: 'archived',
    })
    const active = await repo.listActive(productId)
    expect(active).toHaveLength(1)
    expect(active[0]!.feature_key).toBe('chat')
  })

  it('archive sets status to archived', async () => {
    await repo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: null,
      delivery_mode: null,
      manifest_hash: 'hash_v1',
      status: 'active',
    })
    await repo.archive(productId, 'chat')
    const found = await repo.findByKey(productId, 'chat')
    expect(found!.status).toBe('archived')
  })
})

// ─── RulesRepository ──────────────────────────────────────────────────────────

describe('DefaultRulesRepository', () => {
  let db: Knex
  let products: DefaultProductsRepository
  let repo: DefaultRulesRepository
  let productId: number

  beforeEach(async () => {
    db = createTestKnex()
    await db.migrate.latest()
    products = new DefaultProductsRepository(db)
    repo = new DefaultRulesRepository(db)
    const p = await products.upsertByName('test_product')
    productId = p.id
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('create inserts a rule and returns it', async () => {
    const rule = await repo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"enabled":true}',
      is_active: true,
      created_by: 'admin',
      updated_by: null,
    })
    expect(rule.id).toBeGreaterThan(0)
    expect(rule.feature_key).toBe('chat')
    expect(rule.is_active).toBe(true)
  })

  it('findById returns the rule', async () => {
    const created = await repo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'ios',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{}',
      is_active: true,
      created_by: null,
      updated_by: null,
    })
    const found = await repo.findById(created.id)
    expect(found).toBeDefined()
    expect(found!.platform).toBe('ios')
  })

  it('findById returns undefined for unknown id', async () => {
    const result = await repo.findById(9999)
    expect(result).toBeUndefined()
  })

  it('update changes fields and returns updated row', async () => {
    const rule = await repo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"enabled":true}',
      is_active: true,
      created_by: 'admin',
      updated_by: null,
    })
    const updated = await repo.update(rule.id, { entry_json: '{"enabled":false}', updated_by: 'admin2' })
    expect(updated.entry_json).toBe('{"enabled":false}')
    expect(updated.updated_by).toBe('admin2')
  })

  it('disable sets is_active to false', async () => {
    const rule = await repo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{}',
      is_active: true,
      created_by: null,
      updated_by: null,
    })
    await repo.disable(rule.id, 'admin')
    const found = await repo.findById(rule.id)
    expect(found!.is_active).toBe(false)
    expect(found!.updated_by).toBe('admin')
  })

  it('listActiveByKey returns only active rules for the given key', async () => {
    await repo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{}',
      is_active: true,
      created_by: null,
      updated_by: null,
    })
    const inactiveRule = await repo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'anonymous',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{}',
      is_active: false,
      created_by: null,
      updated_by: null,
    })
    // Ensure the second rule stays inactive
    expect(inactiveRule.is_active).toBe(false)

    const active = await repo.listActiveByKey(productId, 'chat')
    expect(active).toHaveLength(1)
    expect(active[0]!.audience).toBe('all')
  })
})

// ─── RevisionsRepository ──────────────────────────────────────────────────────

describe('DefaultRevisionsRepository', () => {
  let db: Knex
  let products: DefaultProductsRepository
  let repo: DefaultRevisionsRepository
  let productId: number

  beforeEach(async () => {
    db = createTestKnex()
    await db.migrate.latest()
    products = new DefaultProductsRepository(db)
    repo = new DefaultRevisionsRepository(db)
    const p = await products.upsertByName('test_product')
    productId = p.id
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('insert creates a revision entry and returns it', async () => {
    const entry = await repo.insert({
      product_id: productId,
      revision: 1,
      change_type: 'rule_created',
      feature_key: 'chat',
      rule_id: null,
      old_value_json: null,
      new_value_json: '{"enabled":true}',
      reason: 'initial setup',
      changed_by: 'admin',
      request_id: null,
    })
    expect(entry.id).toBeGreaterThan(0)
    expect(entry.revision).toBe(1)
    expect(entry.change_type).toBe('rule_created')
  })

  it('listByProduct returns entries ordered by revision desc', async () => {
    await repo.insert({
      product_id: productId,
      revision: 1,
      change_type: 'rule_created',
      feature_key: 'chat',
      rule_id: null,
      old_value_json: null,
      new_value_json: '{}',
      reason: 'r1',
      changed_by: 'admin',
      request_id: null,
    })
    await repo.insert({
      product_id: productId,
      revision: 2,
      change_type: 'rule_updated',
      feature_key: 'chat',
      rule_id: null,
      old_value_json: '{}',
      new_value_json: '{"enabled":false}',
      reason: 'r2',
      changed_by: 'admin',
      request_id: null,
    })
    const list = await repo.listByProduct(productId)
    expect(list[0]!.revision).toBe(2)
    expect(list[1]!.revision).toBe(1)
  })

  it('listByProduct respects limit', async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.insert({
        product_id: productId,
        revision: i,
        change_type: 'rule_created',
        feature_key: 'chat',
        rule_id: null,
        old_value_json: null,
        new_value_json: '{}',
        reason: `r${i}`,
        changed_by: 'admin',
        request_id: null,
      })
    }
    const list = await repo.listByProduct(productId, 3)
    expect(list).toHaveLength(3)
  })

  it('getByRevision returns all entries for a given revision', async () => {
    await repo.insert({
      product_id: productId,
      revision: 3,
      change_type: 'rule_created',
      feature_key: 'chat',
      rule_id: null,
      old_value_json: null,
      new_value_json: '{}',
      reason: 'test',
      changed_by: 'admin',
      request_id: null,
    })
    const entries = await repo.getByRevision(productId, 3)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.feature_key).toBe('chat')
  })
})

// ─── withTransaction ──────────────────────────────────────────────────────────

describe('withTransaction', () => {
  let db: Knex
  let products: DefaultProductsRepository

  beforeEach(async () => {
    db = createTestKnex()
    await db.migrate.latest()
    products = new DefaultProductsRepository(db)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('commits both inserts when callback succeeds', async () => {
    await withTransaction(db, async (trx) => {
      await trx('products').insert({ name: 'alpha', ttl_seconds: 3600, current_revision: 0 })
      await trx('products').insert({ name: 'beta', ttl_seconds: 3600, current_revision: 0 })
    })
    const rows = await db('products').whereIn('name', ['alpha', 'beta'])
    expect(rows).toHaveLength(2)
  })

  it('rolls back all inserts when callback throws', async () => {
    await expect(
      withTransaction(db, async (trx) => {
        await trx('products').insert({ name: 'gamma', ttl_seconds: 3600, current_revision: 0 })
        throw new Error('intentional rollback')
      })
    ).rejects.toThrow('intentional rollback')

    const rows = await db('products').where({ name: 'gamma' })
    expect(rows).toHaveLength(0)
  })
})
