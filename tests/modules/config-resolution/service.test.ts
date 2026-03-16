import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { DefaultProductsRepository } from '../../../src/modules/products/repository'
import { DefaultDefinitionsRepository } from '../../../src/modules/definitions/repository'
import { DefaultRulesRepository } from '../../../src/modules/rules/repository'
import { DefaultDependenciesRepository } from '../../../src/modules/dependencies/repository'
import { ConfigResolutionService } from '../../../src/modules/config-resolution/service'
import type { RequestContext } from '../../../src/modules/config-resolution/types'

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

function anonCtx(platform: RequestContext['platform'] = 'ios', appVersion = '2.0.0'): RequestContext {
  return { authState: 'anonymous', platform, appVersion }
}

function authCtx(platform: RequestContext['platform'] = 'ios', appVersion = '2.0.0'): RequestContext {
  return { authState: 'authenticated', platform, appVersion }
}

describe('ConfigResolutionService', () => {
  let db: Knex
  let productsRepo: DefaultProductsRepository
  let definitionsRepo: DefaultDefinitionsRepository
  let rulesRepo: DefaultRulesRepository
  let service: ConfigResolutionService
  let productId: number

  beforeAll(async () => {
    db = createTestKnex()
    await db.migrate.latest()
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    // Clean tables between tests
    await db('feature_rules').delete()
    await db('feature_definitions').delete()
    await db('products').delete()

    productsRepo = new DefaultProductsRepository(db)
    definitionsRepo = new DefaultDefinitionsRepository(db)
    rulesRepo = new DefaultRulesRepository(db)
    service = new ConfigResolutionService(productsRepo, definitionsRepo, rulesRepo)

    const product = await productsRepo.upsertByName('test_product', 3600)
    productId = product.id
  })

  // ─── INT-SNAP: Snapshot assembly ────────────────────────────────────────────

  it('INT-SNAP-1: builds snapshot with manifest default when no rules exist', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":true}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })

    const snap = await service.resolveConfig(productId, anonCtx())
    expect(snap.productId).toBe(productId)
    expect(snap.revision).toBe(0)
    expect(snap.ttl).toBe(3600)
    expect(snap.features['chat']).toEqual({ isEnabled: true })
  })

  it('INT-SNAP-2: resolveConfig returns all active definitions', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":true}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'video',
      default_entry_json: '{"isEnabled":false}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })

    const snap = await service.resolveConfig(productId, anonCtx())
    expect(Object.keys(snap.features)).toContain('chat')
    expect(Object.keys(snap.features)).toContain('video')
  })

  it('INT-SNAP-3: archived definitions are excluded from the snapshot', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":true}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'archived',
    })

    const snap = await service.resolveConfig(productId, anonCtx())
    expect(snap.features['chat']).toBeUndefined()
  })

  it('INT-SNAP-4: throws when product not found', async () => {
    await expect(service.resolveConfig(9999, anonCtx())).rejects.toThrow('product not found')
  })

  // ─── INT-RULE: Rule resolution ───────────────────────────────────────────────

  it('INT-RULE-1: rule matching the context overrides manifest default', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":false}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true,"label":"override"}',
      is_active: true,
      created_by: 'admin',
      updated_by: null,
    })

    const snap = await service.resolveConfig(productId, anonCtx())
    expect(snap.features['chat']).toEqual({ isEnabled: true, label: 'override' })
  })

  it('INT-RULE-2: more specific rule wins over less specific rule', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":false}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })
    // general rule
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true,"source":"general"}',
      is_active: true,
      created_by: 'admin',
      updated_by: null,
    })
    // more specific rule (authenticated + ios)
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'authenticated',
      platform: 'ios',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true,"source":"specific"}',
      is_active: true,
      created_by: 'admin',
      updated_by: null,
    })

    const snap = await service.resolveConfig(productId, authCtx('ios'))
    expect((snap.features['chat'] as unknown as { source: string }).source).toBe('specific')
  })

  it('INT-RULE-3: inactive rule is ignored', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":false}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true}',
      is_active: false,
      created_by: 'admin',
      updated_by: null,
    })

    const snap = await service.resolveConfig(productId, anonCtx())
    expect(snap.features['chat']).toEqual({ isEnabled: false })
  })

  // ─── INT-REPO: listAllActive ─────────────────────────────────────────────────

  it('INT-REPO-1: listAllActive returns all active rules for a product', async () => {
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true}',
      is_active: true,
      created_by: null,
      updated_by: null,
    })
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'video',
      audience: 'authenticated',
      platform: 'ios',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true}',
      is_active: true,
      created_by: null,
      updated_by: null,
    })

    const rules = await rulesRepo.listAllActive(productId)
    expect(rules).toHaveLength(2)
    const keys = rules.map((r) => r.feature_key)
    expect(keys).toContain('chat')
    expect(keys).toContain('video')
  })

  it('INT-REPO-2: listAllActive excludes inactive rules', async () => {
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true}',
      is_active: true,
      created_by: null,
      updated_by: null,
    })
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'anonymous',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":false}',
      is_active: false,
      created_by: null,
      updated_by: null,
    })

    const rules = await rulesRepo.listAllActive(productId)
    expect(rules).toHaveLength(1)
    expect(rules[0]!.audience).toBe('all')
  })

  it('INT-REPO-3: listAllActive returns empty array when no active rules', async () => {
    const rules = await rulesRepo.listAllActive(productId)
    expect(rules).toHaveLength(0)
  })

  // ─── INT-CACHE: Cache behavior ───────────────────────────────────────────────

  it('INT-CACHE-1: buildRawSnapshot is called only once for the same revision', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":true}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })

    const spy = vi.spyOn(rulesRepo, 'listAllActive')

    await service.resolveConfig(productId, anonCtx())
    await service.resolveConfig(productId, authCtx())

    // listAllActive should be called only once because revision didn't change
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('INT-CACHE-2: invalidateCache clears the cache for the product', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":true}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })

    const spy = vi.spyOn(rulesRepo, 'listAllActive')

    await service.resolveConfig(productId, anonCtx())
    service.invalidateCache(productId)
    await service.resolveConfig(productId, anonCtx())

    // After invalidation, listAllActive is called again
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('INT-CACHE-3: rebuildSnapshot invalidates and reloads fresh data', async () => {
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      default_entry_json: '{"isEnabled":false}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'hash1',
      status: 'active',
    })

    // Populate cache
    const snap1 = await service.resolveConfig(productId, anonCtx())
    expect(snap1.features['chat']).toEqual({ isEnabled: false })

    // Add a rule directly to DB — simulates an admin write that already advanced
    // We just verify rebuildSnapshot fetches fresh definitions + rules
    await rulesRepo.create({
      product_id: productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      min_app_version: null,
      max_app_version: null,
      entry_json: '{"isEnabled":true}',
      is_active: true,
      created_by: 'admin',
      updated_by: null,
    })

    await service.rebuildSnapshot(productId)
    const snap2 = await service.resolveConfig(productId, anonCtx())
    expect(snap2.features['chat']).toEqual({ isEnabled: true })
  })
})

// ─── Dependency propagation tests ─────────────────────────────────────────────

function createTestKnex2(): Knex {
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

const BASE_DEF_PROP = {
  payload_schema_json: null as null,
  manifest_owner: null as null,
  source_priority_mode: 'server',
  delivery_mode: 'remoteCapable',
  manifest_hash: 'hash-prop',
  status: 'active' as const,
}

describe('Dependency propagation', () => {
  let db2: Knex
  let productsRepo2: DefaultProductsRepository
  let definitionsRepo2: DefaultDefinitionsRepository
  let rulesRepo2: DefaultRulesRepository
  let depsRepo: DefaultDependenciesRepository
  let service2: ConfigResolutionService
  let productId2: number

  beforeAll(async () => {
    db2 = createTestKnex2()
    await db2.migrate.latest()
    productsRepo2 = new DefaultProductsRepository(db2)
    definitionsRepo2 = new DefaultDefinitionsRepository(db2)
    rulesRepo2 = new DefaultRulesRepository(db2)
    depsRepo = new DefaultDependenciesRepository(db2)
    service2 = new ConfigResolutionService(productsRepo2, definitionsRepo2, rulesRepo2, depsRepo)
    const product = await productsRepo2.upsertByName('prop_product', 3600)
    productId2 = product.id
  })

  afterAll(async () => {
    await db2.destroy()
  })

  beforeEach(async () => {
    await db2('flag_dependencies').delete()
    await db2('feature_rules').delete()
    await db2('feature_definitions').delete()
    service2.invalidateCache(productId2)
  })

  async function upsertDef(key: string, isEnabled: boolean) {
    await definitionsRepo2.upsert({
      product_id: productId2,
      feature_key: key,
      default_entry_json: JSON.stringify({ isEnabled }),
      ...BASE_DEF_PROP,
    })
  }

  async function addEdge(parent: string, child: string) {
    await depsRepo.add({ product_id: productId2, parent_feature_key: parent, child_feature_key: child, reason: null })
  }

  // PROP-1: parent disabled → child disabled (basic propagation)
  it('PROP-1: parent disabled propagates to child', async () => {
    await upsertDef('parent_feat', false)  // disabled
    await upsertDef('child_feat', true)    // enabled by default
    await addEdge('parent_feat', 'child_feat')
    service2.invalidateCache(productId2)

    const snap = await service2.resolveConfig(productId2, anonCtx())
    expect((snap.features['child_feat'] as { isEnabled?: boolean }).isEnabled).toBe(false)
  })

  // PROP-2: parent enabled → child keeps its own resolved value (no propagation)
  it('PROP-2: parent enabled does not force child to any specific value', async () => {
    await upsertDef('parent_feat', true)  // enabled
    await upsertDef('child_feat', true)   // enabled
    await addEdge('parent_feat', 'child_feat')
    service2.invalidateCache(productId2)

    const snap = await service2.resolveConfig(productId2, anonCtx())
    expect((snap.features['child_feat'] as { isEnabled?: boolean }).isEnabled).toBe(true)
  })

  // PROP-3: chain A→B→C: disabling A disables B and C
  it('PROP-3: chain propagation A→B→C disabled when A disabled', async () => {
    await upsertDef('feat_a', false)
    await upsertDef('feat_b', true)
    await upsertDef('feat_c', true)
    await addEdge('feat_a', 'feat_b')
    await addEdge('feat_b', 'feat_c')
    service2.invalidateCache(productId2)

    const snap = await service2.resolveConfig(productId2, anonCtx())
    expect((snap.features['feat_b'] as { isEnabled?: boolean }).isEnabled).toBe(false)
    expect((snap.features['feat_c'] as { isEnabled?: boolean }).isEnabled).toBe(false)
  })

  // PROP-4: AND semantics: A disabled + B enabled, both parents of C → C disabled
  it('PROP-4: AND semantics — one disabled parent disables child', async () => {
    await upsertDef('dep_a', false)   // disabled
    await upsertDef('dep_b', true)    // enabled
    await upsertDef('dep_c', true)    // enabled by default
    await addEdge('dep_a', 'dep_c')
    await addEdge('dep_b', 'dep_c')
    service2.invalidateCache(productId2)

    const snap = await service2.resolveConfig(productId2, anonCtx())
    expect((snap.features['dep_c'] as { isEnabled?: boolean }).isEnabled).toBe(false)
  })

  // PROP-5: AND semantics: A enabled + B enabled, both parents of C → C enabled
  it('PROP-5: AND semantics — all parents enabled keeps child enabled', async () => {
    await upsertDef('dep_a', true)
    await upsertDef('dep_b', true)
    await upsertDef('dep_c', true)
    await addEdge('dep_a', 'dep_c')
    await addEdge('dep_b', 'dep_c')
    service2.invalidateCache(productId2)

    const snap = await service2.resolveConfig(productId2, anonCtx())
    expect((snap.features['dep_c'] as { isEnabled?: boolean }).isEnabled).toBe(true)
  })

  // PROP-6: orphaned edge (key not in features) is silently ignored — no crash
  it('PROP-6: orphaned edge key not in features is silently ignored', async () => {
    await upsertDef('real_feat', true)
    // Insert an edge referencing a non-existent key directly
    await db2('flag_dependencies').insert({
      product_id: productId2,
      parent_feature_key: 'ghost_feat',
      child_feature_key: 'real_feat',
      reason: null,
    })
    service2.invalidateCache(productId2)

    const snap = await service2.resolveConfig(productId2, anonCtx())
    // real_feat is unchanged — orphaned edge is ignored
    expect((snap.features['real_feat'] as { isEnabled?: boolean }).isEnabled).toBe(true)
  })

  // PROP-7: cycle safety-net — artificially insert a cycle, resolveConfig doesn't crash
  it('PROP-7: cycle in DB does not crash resolveConfig', async () => {
    await upsertDef('cycle_a', true)
    await upsertDef('cycle_b', true)
    // Artificially insert a cycle bypassing cycle detection
    await db2('flag_dependencies').insert([
      { product_id: productId2, parent_feature_key: 'cycle_a', child_feature_key: 'cycle_b', reason: null },
      { product_id: productId2, parent_feature_key: 'cycle_b', child_feature_key: 'cycle_a', reason: null },
    ])
    service2.invalidateCache(productId2)

    // Must not throw
    const snap = await service2.resolveConfig(productId2, anonCtx())
    expect(snap.features['cycle_a']).toBeDefined()
    expect(snap.features['cycle_b']).toBeDefined()
  })
})
