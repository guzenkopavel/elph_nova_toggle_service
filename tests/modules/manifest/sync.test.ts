import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { DefaultDefinitionsRepository } from '../../../src/modules/definitions/repository'
import { DefaultProductsRepository } from '../../../src/modules/products/repository'
import { ManifestSyncService } from '../../../src/modules/manifest/sync'
import type { ManifestDefinition } from '../../../src/modules/manifest/registry'
import type { DefinitionsRepository } from '../../../src/modules/definitions/repository'

function createTestKnex(): Knex {
  return KnexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, '../../../src/db/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  })
}

function makeDefinition(key: string, overrides: Partial<ManifestDefinition> = {}): ManifestDefinition {
  return {
    feature_key: key,
    name: `Feature ${key}`,
    description: undefined,
    owner: 'mobile-core',
    delivery_mode: 'remoteCapable',
    source_priority_mode: 'serverWins',
    default_entry_json: JSON.stringify({ isEnabled: true }),
    payload_schema_json: null,
    ...overrides,
  }
}

describe('ManifestSyncService', () => {
  let db: Knex
  let definitionsRepo: DefaultDefinitionsRepository
  let productsRepo: DefaultProductsRepository
  let syncService: ManifestSyncService

  beforeEach(async () => {
    db = createTestKnex()
    await db.migrate.latest()
    definitionsRepo = new DefaultDefinitionsRepository(db)
    productsRepo = new DefaultProductsRepository(db)
    syncService = new ManifestSyncService(db, definitionsRepo, productsRepo)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('syncs one remoteCapable feature and sets manifest_hash on product', async () => {
    const result = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [makeDefinition('chat')],
    })

    expect(result.upserted).toBe(1)
    expect(result.archived).toBe(0)
    expect(result.manifestHash).toBe('hash_v1')
    expect(result.productId).toBeGreaterThan(0)

    const rows = await db('feature_definitions')
      .where({ product_id: result.productId, feature_key: 'chat' })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('active')
    expect(rows[0].manifest_hash).toBe('hash_v1')

    const product = await db('products').where({ id: result.productId }).first()
    expect(product.manifest_hash).toBe('hash_v1')
  })

  it('upsert with same key twice preserves one row with the latest default_entry_json', async () => {
    const def1 = makeDefinition('chat', { default_entry_json: JSON.stringify({ isEnabled: true }) })
    const def2 = makeDefinition('chat', { default_entry_json: JSON.stringify({ isEnabled: false }) })

    await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [def1],
    })

    const result2 = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v2',
      definitions: [def2],
    })

    const rows = await db('feature_definitions')
      .where({ product_id: result2.productId, feature_key: 'chat' })
    expect(rows).toHaveLength(1)
    expect(rows[0].default_entry_json).toBe(JSON.stringify({ isEnabled: false }))
    expect(rows[0].status).toBe('active')
  })

  it('archives keys removed from manifest without hard-deleting them', async () => {
    await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [makeDefinition('chat'), makeDefinition('calls')],
    })

    const result2 = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v2',
      definitions: [makeDefinition('chat')],
    })

    expect(result2.archived).toBe(1)

    const callsRows = await db('feature_definitions')
      .where({ product_id: result2.productId, feature_key: 'calls' })
    expect(callsRows).toHaveLength(1)
    expect(callsRows[0].status).toBe('archived')

    const chatRows = await db('feature_definitions')
      .where({ product_id: result2.productId, feature_key: 'chat' })
    expect(chatRows).toHaveLength(1)
    expect(chatRows[0].status).toBe('active')
  })

  it('stores payload_schema_json when feature has payload', async () => {
    const def = makeDefinition('chat', {
      payload_schema_json: JSON.stringify({ swiftTypeName: 'ChatPayload', fields: [{ name: 'value', type: 'string' }] }),
    })

    const result = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [def],
    })

    const row = await db('feature_definitions')
      .where({ product_id: result.productId, feature_key: 'chat' })
      .first()
    expect(row.payload_schema_json).not.toBeNull()
    const parsed = JSON.parse(row.payload_schema_json)
    expect(parsed.swiftTypeName).toBe('ChatPayload')
  })

  it('stores null payload_schema_json when feature has no payload', async () => {
    const result = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [makeDefinition('chat')],
    })

    const row = await db('feature_definitions')
      .where({ product_id: result.productId, feature_key: 'chat' })
      .first()
    expect(row.payload_schema_json).toBeNull()
  })

  it('idempotent re-run with same input produces no error and same row count', async () => {
    const defs = [makeDefinition('chat'), makeDefinition('calls')]

    const result1 = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: defs,
    })
    const result2 = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: defs,
    })

    expect(result1.upserted).toBe(2)
    expect(result2.upserted).toBe(2)
    expect(result2.archived).toBe(0)

    const allRows = await db('feature_definitions')
      .where({ product_id: result2.productId })
    expect(allRows).toHaveLength(2)
  })

  it('updates manifest_hash in products table after sync', async () => {
    const result = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'initial_hash',
      definitions: [makeDefinition('chat')],
    })

    const product = await db('products').where({ id: result.productId }).first()
    expect(product.manifest_hash).toBe('initial_hash')

    await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'updated_hash',
      definitions: [makeDefinition('chat')],
    })

    const updated = await db('products').where({ id: result.productId }).first()
    expect(updated.manifest_hash).toBe('updated_hash')
  })

  it('calls invalidateCache after sync when resolutionService is provided', async () => {
    const mockResolutionService = { invalidateCache: vi.fn() }
    const syncServiceWithCache = new ManifestSyncService(db, definitionsRepo, productsRepo, mockResolutionService)

    const result = await syncServiceWithCache.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [makeDefinition('chat')],
    })

    expect(mockResolutionService.invalidateCache).toHaveBeenCalledOnce()
    expect(mockResolutionService.invalidateCache).toHaveBeenCalledWith(result.productId)
  })

  it('does not call invalidateCache when resolutionService is not provided', async () => {
    // syncService is created without resolutionService in the default beforeEach
    const result = await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [makeDefinition('chat')],
    })
    // Just ensure it doesn't throw and returns a valid result
    expect(result.productId).toBeGreaterThan(0)
  })

  it('rolls back the transaction when archive throws', async () => {
    await syncService.sync({
      productName: 'elph_nova',
      manifestHash: 'hash_v1',
      definitions: [makeDefinition('chat'), makeDefinition('calls')],
    })

    const failingRepo: DefinitionsRepository = {
      upsert: vi.fn().mockImplementation((row, trx) => definitionsRepo.upsert(row, trx)),
      findByKey: vi.fn().mockImplementation((productId, featureKey) => definitionsRepo.findByKey(productId, featureKey)),
      listActive: vi.fn().mockImplementation((productId) => definitionsRepo.listActive(productId)),
      archive: vi.fn().mockRejectedValue(new Error('archive exploded')),
    }

    const failingSyncService = new ManifestSyncService(db, failingRepo, productsRepo)

    await expect(
      failingSyncService.sync({
        productName: 'elph_nova',
        manifestHash: 'hash_v2',
        definitions: [makeDefinition('chat')],
      }),
    ).rejects.toThrow('archive exploded')

    // DB should still reflect hash_v1 (rollback occurred)
    const product = await db('products').where({ name: 'elph_nova' }).first()
    expect(product.manifest_hash).toBe('hash_v1')

    // calls should still be active
    const callsRow = await db('feature_definitions')
      .where({ feature_key: 'calls', status: 'active' })
      .first()
    expect(callsRow).toBeDefined()
  })
})
