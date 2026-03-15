import type { Knex } from 'knex'

export interface ProductRow {
  id: number
  name: string
  ttl_seconds: number
  manifest_hash: string | null
  current_revision: number
  created_at: string
  updated_at: string
}

export interface ProductsRepository {
  findById(id: number): Promise<ProductRow | undefined>
  upsertByName(name: string, ttlSeconds?: number, trx?: Knex.Transaction): Promise<ProductRow>
  updateRevision(id: number, newRevision: number, expectedRevision: number, trx?: Knex.Transaction): Promise<void>
  updateManifestHash(id: number, hash: string, trx?: Knex.Transaction): Promise<void>
}

export class DefaultProductsRepository implements ProductsRepository {
  constructor(private readonly db: Knex) {}

  async findById(id: number): Promise<ProductRow | undefined> {
    return this.db<ProductRow>('products').where({ id }).first()
  }

  async upsertByName(name: string, ttlSeconds = 3600, trx?: Knex.Transaction): Promise<ProductRow> {
    const qb = trx ? trx<ProductRow>('products') : this.db<ProductRow>('products')
    await qb.insert({ name, ttl_seconds: ttlSeconds, current_revision: 0 }).onConflict(['name']).ignore()
    const row = await (trx ? trx<ProductRow>('products') : this.db<ProductRow>('products'))
      .where({ name })
      .first()
    return row!
  }

  async updateRevision(id: number, newRevision: number, expectedRevision: number, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ? trx<ProductRow>('products') : this.db<ProductRow>('products')
    const count = await qb
      .where({ id, current_revision: expectedRevision })
      .update({
        current_revision: newRevision,
        updated_at: (trx ?? this.db).fn.now() as unknown as string,
      })
    if (count === 0) {
      throw new Error(`Revision conflict: expected ${expectedRevision} for product ${id}`)
    }
  }

  async updateManifestHash(id: number, hash: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ? trx<ProductRow>('products') : this.db<ProductRow>('products')
    await qb.where({ id }).update({
      manifest_hash: hash,
      updated_at: (trx ?? this.db).fn.now() as unknown as string,
    })
  }
}
