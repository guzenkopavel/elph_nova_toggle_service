import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdminRulesService, ValidationError, ConflictError, NotFoundError } from '../../../src/modules/admin/service'
import type { RuleRow } from '../../../src/modules/rules/repository'
import type { ProductRow } from '../../../src/modules/products/repository'
import type { ManifestDefinition } from '../../../src/modules/manifest/registry'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: 1,
    product_id: 10,
    feature_key: 'chat',
    audience: 'all',
    platform: 'all',
    min_app_version: null,
    max_app_version: null,
    entry_json: '{"isEnabled":true}',
    is_active: true,
    created_by: null,
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeProduct(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 10,
    name: 'test_product',
    ttl_seconds: 3600,
    manifest_hash: null,
    current_revision: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeDef(overrides: Partial<ManifestDefinition> = {}): ManifestDefinition {
  return {
    feature_key: 'chat',
    name: 'Chat',
    description: undefined,
    owner: undefined,
    delivery_mode: 'remoteCapable',
    source_priority_mode: 'serverWins',
    default_entry_json: '{"isEnabled":false}',
    payload_schema_json: null,
    ...overrides,
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makeRegistry(hasKey = true, def?: ManifestDefinition) {
  return {
    hasKey: vi.fn().mockReturnValue(hasKey),
    getByKey: vi.fn().mockReturnValue(def ?? makeDef()),
  }
}

function makeRulesRepo(overrides: Record<string, unknown> = {}) {
  return {
    findById: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(makeRule()),
    update: vi.fn().mockResolvedValue(makeRule()),
    disable: vi.fn().mockResolvedValue(undefined),
    listAllActive: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function makeProductsRepo(product?: ProductRow) {
  return {
    findById: vi.fn().mockResolvedValue(product ?? makeProduct()),
    updateRevision: vi.fn().mockResolvedValue(undefined),
    upsertByName: vi.fn(),
    updateManifestHash: vi.fn(),
  }
}

function makeRevisionsRepo() {
  return {
    insert: vi.fn().mockResolvedValue({ id: 1 }),
    listByProduct: vi.fn().mockResolvedValue([]),
    getByRevision: vi.fn().mockResolvedValue([]),
  }
}

function makeResolutionService() {
  return {
    invalidateCache: vi.fn(),
    resolveConfig: vi.fn(),
    buildRawSnapshot: vi.fn(),
    rebuildSnapshot: vi.fn(),
  }
}

// A real in-memory Knex just to pass to withTransaction.
// We mock all repo calls so no actual SQL runs.
import KnexLib from 'knex'
import path from 'path'

function makeDb() {
  return KnexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(process.cwd(), 'src/db/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminRulesService', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(async () => {
    db = makeDb()
    await db.migrate.latest()
  })

  // U1: createRule rejects unknown feature key
  it('U1: createRule throws ValidationError for unknown feature key', async () => {
    const registry = makeRegistry(false)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await expect(service.createRule({
      productId: 10,
      feature_key: 'unknown_key',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'test',
      expectedRevision: 0,
    })).rejects.toThrow(ValidationError)
  })

  // U2: createRule rejects empty reason
  it('U2: createRule throws ValidationError for empty reason', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await expect(service.createRule({
      productId: 10,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: '  ',
      expectedRevision: 0,
    })).rejects.toThrow(ValidationError)
  })

  // U3: createRule rejects revision conflict from updateRevision
  it('U3: createRule throws ConflictError on revision conflict', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    productsRepo.updateRevision.mockRejectedValue(new Error('Revision conflict'))
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await expect(service.createRule({
      productId: 10,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'reason',
      expectedRevision: 99,
    })).rejects.toThrow(ConflictError)
  })

  // U4: createRule succeeds and invalidates cache
  it('U4: createRule succeeds and calls invalidateCache', async () => {
    const registry = makeRegistry(true)
    const createdRule = makeRule({ id: 42 })
    const rulesRepo = makeRulesRepo({ create: vi.fn().mockResolvedValue(createdRule) })
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    const result = await service.createRule({
      productId: 10,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'enable chat',
      expectedRevision: 0,
    })

    expect(result.id).toBe(42)
    expect(resolutionService.invalidateCache).toHaveBeenCalledWith(10)
  })

  // U5: updateRule returns NotFoundError for inactive rule
  it('U5: updateRule throws NotFoundError for inactive rule', async () => {
    const registry = makeRegistry(true)
    const inactiveRule = makeRule({ is_active: false })
    const rulesRepo = makeRulesRepo({ findById: vi.fn().mockResolvedValue(inactiveRule) })
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await expect(service.updateRule({
      productId: 10,
      ruleId: 1,
      reason: 'update',
      expectedRevision: 0,
    })).rejects.toThrow(NotFoundError)
  })

  // U6: updateRule throws NotFoundError when rule belongs to different product
  it('U6: updateRule throws NotFoundError when rule belongs to different product', async () => {
    const registry = makeRegistry(true)
    const rule = makeRule({ product_id: 99 })
    const rulesRepo = makeRulesRepo({ findById: vi.fn().mockResolvedValue(rule) })
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await expect(service.updateRule({
      productId: 10,
      ruleId: 1,
      reason: 'update',
      expectedRevision: 0,
    })).rejects.toThrow(NotFoundError)
  })

  // U7: updateRule succeeds and invalidates cache
  it('U7: updateRule succeeds and calls invalidateCache', async () => {
    const registry = makeRegistry(true)
    const existingRule = makeRule()
    const updatedRule = makeRule({ entry_json: '{"isEnabled":false}' })
    const rulesRepo = makeRulesRepo({
      findById: vi.fn().mockResolvedValue(existingRule),
      update: vi.fn().mockResolvedValue(updatedRule),
    })
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    const result = await service.updateRule({
      productId: 10,
      ruleId: 1,
      entry_json: { isEnabled: false },
      reason: 'disable chat',
      expectedRevision: 0,
    })

    expect(result.entry_json).toBe('{"isEnabled":false}')
    expect(resolutionService.invalidateCache).toHaveBeenCalledWith(10)
  })

  // U8: disableRule throws NotFoundError for already-inactive rule
  it('U8: disableRule throws NotFoundError for already-inactive rule', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo({ findById: vi.fn().mockResolvedValue(makeRule({ is_active: false })) })
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await expect(service.disableRule({
      productId: 10,
      ruleId: 1,
      reason: 'no longer needed',
      expectedRevision: 0,
    })).rejects.toThrow(NotFoundError)
  })

  // U9: disableRule succeeds and invalidates cache
  it('U9: disableRule succeeds and calls invalidateCache', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo({ findById: vi.fn().mockResolvedValue(makeRule()) })
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await service.disableRule({
      productId: 10,
      ruleId: 1,
      reason: 'cleanup',
      expectedRevision: 0,
    })

    expect(rulesRepo.disable).toHaveBeenCalledWith(1, 'unknown', expect.anything())
    expect(resolutionService.invalidateCache).toHaveBeenCalledWith(10)
  })

  // U10: validateEntryJson rejects unknown fields when payload schema has fields
  it('U10: createRule throws ValidationError for unknown field when schema is defined', async () => {
    const schemaDef = makeDef({
      payload_schema_json: JSON.stringify({
        fields: [{ name: 'isEnabled', type: 'boolean' }, { name: 'label', type: 'string' }],
      }),
    })
    const registry = makeRegistry(true, schemaDef)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    await expect(service.createRule({
      productId: 10,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true, unknownField: 'bad' },
      reason: 'test',
      expectedRevision: 0,
    })).rejects.toThrow(ValidationError)
  })
})
