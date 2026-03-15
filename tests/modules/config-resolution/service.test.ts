import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { DefaultProductsRepository } from '../../../src/modules/products/repository'
import { DefaultDefinitionsRepository } from '../../../src/modules/definitions/repository'
import { DefaultRulesRepository } from '../../../src/modules/rules/repository'
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
