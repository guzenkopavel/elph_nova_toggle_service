import type { Knex } from 'knex'

export interface DependencyRow {
  id: number
  product_id: number
  parent_feature_key: string
  child_feature_key: string
  reason: string | null
  created_at: string
}

export type DependencyInsert = Omit<DependencyRow, 'id' | 'created_at'>

export interface DependenciesRepository {
  add(dep: DependencyInsert, trx?: Knex.Transaction): Promise<DependencyRow>
  remove(id: number, trx?: Knex.Transaction): Promise<void>
  findById(id: number): Promise<DependencyRow | undefined>
  listByProduct(productId: number): Promise<DependencyRow[]>
  findEdge(productId: number, parentKey: string, childKey: string): Promise<DependencyRow | undefined>
}

export class DefaultDependenciesRepository implements DependenciesRepository {
  constructor(private readonly db: Knex) {}

  async add(dep: DependencyInsert, trx?: Knex.Transaction): Promise<DependencyRow> {
    const qb = trx ? trx<DependencyRow>('flag_dependencies') : this.db<DependencyRow>('flag_dependencies')
    const result = await qb.insert(dep).returning('id')
    const id = typeof result[0] === 'object' ? (result[0] as { id: number }).id : (result[0] as number)
    const inserted = await (trx ?? this.db)<DependencyRow>('flag_dependencies').where({ id }).first()
    if (!inserted) throw new Error(`Failed to retrieve dependency after insert (id=${id})`)
    return inserted
  }

  async remove(id: number, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ? trx<DependencyRow>('flag_dependencies') : this.db<DependencyRow>('flag_dependencies')
    await qb.where({ id }).delete()
  }

  async findById(id: number): Promise<DependencyRow | undefined> {
    return this.db<DependencyRow>('flag_dependencies').where({ id }).first()
  }

  async listByProduct(productId: number): Promise<DependencyRow[]> {
    return this.db<DependencyRow>('flag_dependencies').where({ product_id: productId }).orderBy('id')
  }

  async findEdge(productId: number, parentKey: string, childKey: string): Promise<DependencyRow | undefined> {
    return this.db<DependencyRow>('flag_dependencies')
      .where({ product_id: productId, parent_feature_key: parentKey, child_feature_key: childKey })
      .first()
  }
}
