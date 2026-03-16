import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdminRulesService, ValidationError, ConflictError, NotFoundError } from '../../../src/modules/admin/service'
import type { RuleRow } from '../../../src/modules/rules/repository'
import type { ProductRow } from '../../../src/modules/products/repository'
import type { ManifestDefinition } from '../../../src/modules/manifest/registry'
import type { DependencyRow } from '../../../src/modules/dependencies/repository'

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

  // ─── Dependency methods ───────────────────────────────────────────────────

  function makeDep(overrides: Partial<DependencyRow> = {}): DependencyRow {
    return {
      id: 1,
      product_id: 10,
      parent_feature_key: 'chat',
      child_feature_key: 'video_call',
      reason: null,
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
  }

  function makeDepsRepo(overrides: Record<string, unknown> = {}) {
    return {
      add: vi.fn().mockResolvedValue(makeDep()),
      remove: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue(undefined),
      findEdge: vi.fn().mockResolvedValue(undefined),
      listByProduct: vi.fn().mockResolvedValue([]),
      ...overrides,
    }
  }

  it('D1: addDependency creates edge and bumps revision', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const depsRepo = makeDepsRepo()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    const result = await service.addDependency({
      productId: 10,
      parentKey: 'chat',
      childKey: 'video_call',
      expectedRevision: 0,
    })

    expect(depsRepo.add).toHaveBeenCalled()
    expect(revisionsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ change_type: 'dependency_added' }),
      expect.anything(),
    )
    expect(resolutionService.invalidateCache).toHaveBeenCalledWith(10)
    expect(result.parent_feature_key).toBe('chat')
  })

  it('D2: addDependency ValidationError on unknown parent key', async () => {
    const registry = makeRegistry(false)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const depsRepo = makeDepsRepo()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    await expect(service.addDependency({
      productId: 10,
      parentKey: 'unknown',
      childKey: 'video_call',
      expectedRevision: 0,
    })).rejects.toThrow(ValidationError)
  })

  it('D3: addDependency ValidationError on self-dependency', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const depsRepo = makeDepsRepo()

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    await expect(service.addDependency({
      productId: 10,
      parentKey: 'chat',
      childKey: 'chat',
      expectedRevision: 0,
    })).rejects.toThrow(ValidationError)
  })

  it('D4: addDependency ValidationError on duplicate edge', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const depsRepo = makeDepsRepo({
      findEdge: vi.fn().mockResolvedValue(makeDep()),
    })

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    await expect(service.addDependency({
      productId: 10,
      parentKey: 'chat',
      childKey: 'video_call',
      expectedRevision: 0,
    })).rejects.toThrow(ValidationError)
  })

  it('D5: addDependency ValidationError on cycle', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    // Existing edge: video_call → chat; proposing chat → video_call creates cycle
    const depsRepo = makeDepsRepo({
      listByProduct: vi.fn().mockResolvedValue([
        makeDep({ parent_feature_key: 'video_call', child_feature_key: 'chat' }),
      ]),
    })

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    await expect(service.addDependency({
      productId: 10,
      parentKey: 'chat',
      childKey: 'video_call',
      expectedRevision: 0,
    })).rejects.toThrow(ValidationError)
  })

  it('D6: removeDependency removes edge and bumps revision', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const depsRepo = makeDepsRepo({
      findById: vi.fn().mockResolvedValue(makeDep({ id: 5 })),
    })

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    await service.removeDependency({ productId: 10, depId: 5, expectedRevision: 0 })

    expect(depsRepo.remove).toHaveBeenCalledWith(5, expect.anything())
    expect(revisionsRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ change_type: 'dependency_removed' }),
      expect.anything(),
    )
    expect(resolutionService.invalidateCache).toHaveBeenCalledWith(10)
  })

  it('D7: removeDependency NotFoundError on missing dep', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const depsRepo = makeDepsRepo({
      findById: vi.fn().mockResolvedValue(undefined),
    })

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    await expect(service.removeDependency({ productId: 10, depId: 999, expectedRevision: 0 })).rejects.toThrow(NotFoundError)
  })

  it('D8: removeDependency NotFoundError when dep belongs to different product', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const depsRepo = makeDepsRepo({
      findById: vi.fn().mockResolvedValue(makeDep({ product_id: 999 })),
    })

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    await expect(service.removeDependency({ productId: 10, depId: 1, expectedRevision: 0 })).rejects.toThrow(NotFoundError)
  })

  it('D9: listDependencies returns all edges', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()
    const deps = [makeDep(), makeDep({ id: 2, child_feature_key: 'premium' })]
    const depsRepo = makeDepsRepo({
      listByProduct: vi.fn().mockResolvedValue(deps),
    })

    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any, depsRepo as any)

    const result = await service.listDependencies(10)
    expect(result).toHaveLength(2)
    expect(depsRepo.listByProduct).toHaveBeenCalledWith(10)
  })

  it('D10: listDependencies returns [] when depsRepo not provided', async () => {
    const registry = makeRegistry(true)
    const rulesRepo = makeRulesRepo()
    const productsRepo = makeProductsRepo()
    const revisionsRepo = makeRevisionsRepo()
    const resolutionService = makeResolutionService()

    // No depsRepo passed
    const service = new AdminRulesService(db, registry as any, rulesRepo as any, productsRepo as any, revisionsRepo as any, resolutionService as any)

    const result = await service.listDependencies(10)
    expect(result).toEqual([])
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
