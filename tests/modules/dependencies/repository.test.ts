import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { DefaultDependenciesRepository } from '../../../src/modules/dependencies/repository'
import { DefaultProductsRepository } from '../../../src/modules/products/repository'

function createTestKnex(): Knex {
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

describe('DefaultDependenciesRepository', () => {
  let db: Knex
  let repo: DefaultDependenciesRepository
  let productId: number

  beforeEach(async () => {
    db = createTestKnex()
    await db.migrate.latest()
    const productsRepo = new DefaultProductsRepository(db)
    const product = await productsRepo.upsertByName('dep_test_product', 3600)
    productId = product.id
    repo = new DefaultDependenciesRepository(db)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('R1: add and retrieve a dependency edge', async () => {
    const dep = await repo.add({
      product_id: productId,
      parent_feature_key: 'chat',
      child_feature_key: 'video_call',
      reason: 'video requires chat',
    })

    expect(dep.id).toBeTypeOf('number')
    expect(dep.product_id).toBe(productId)
    expect(dep.parent_feature_key).toBe('chat')
    expect(dep.child_feature_key).toBe('video_call')
    expect(dep.reason).toBe('video requires chat')

    const found = await repo.findById(dep.id)
    expect(found).toBeDefined()
    expect(found?.parent_feature_key).toBe('chat')
  })

  it('R2: findEdge returns undefined for missing edge', async () => {
    const result = await repo.findEdge(productId, 'nonexistent_parent', 'nonexistent_child')
    expect(result).toBeUndefined()
  })

  it('R3: findEdge returns the edge when it exists', async () => {
    await repo.add({
      product_id: productId,
      parent_feature_key: 'chat',
      child_feature_key: 'video_call',
      reason: null,
    })

    const found = await repo.findEdge(productId, 'chat', 'video_call')
    expect(found).toBeDefined()
    expect(found?.parent_feature_key).toBe('chat')
    expect(found?.child_feature_key).toBe('video_call')
  })

  it('R4: listByProduct returns all edges for product ordered by id', async () => {
    await repo.add({ product_id: productId, parent_feature_key: 'a', child_feature_key: 'b', reason: null })
    await repo.add({ product_id: productId, parent_feature_key: 'b', child_feature_key: 'c', reason: null })

    const edges = await repo.listByProduct(productId)
    expect(edges).toHaveLength(2)
    expect(edges[0].parent_feature_key).toBe('a')
    expect(edges[1].parent_feature_key).toBe('b')
  })

  it('R5: remove deletes an edge', async () => {
    const dep = await repo.add({
      product_id: productId,
      parent_feature_key: 'chat',
      child_feature_key: 'video_call',
      reason: null,
    })

    await repo.remove(dep.id)

    const found = await repo.findById(dep.id)
    expect(found).toBeUndefined()

    const edges = await repo.listByProduct(productId)
    expect(edges).toHaveLength(0)
  })

  it('R6: unique constraint prevents duplicate edges', async () => {
    await repo.add({ product_id: productId, parent_feature_key: 'chat', child_feature_key: 'video_call', reason: null })
    await expect(
      repo.add({ product_id: productId, parent_feature_key: 'chat', child_feature_key: 'video_call', reason: 'duplicate' })
    ).rejects.toThrow()
  })

  it('R7: add with null reason stores null correctly', async () => {
    const dep = await repo.add({
      product_id: productId,
      parent_feature_key: 'feat_a',
      child_feature_key: 'feat_b',
      reason: null,
    })
    expect(dep.reason).toBeNull()
  })

  it('R8: listByProduct returns empty array when no edges', async () => {
    const edges = await repo.listByProduct(productId)
    expect(edges).toEqual([])
  })
})
