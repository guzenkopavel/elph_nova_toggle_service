import type { Knex } from 'knex'

export interface RevisionRow {
  id: number
  product_id: number
  revision: number
  change_type: string
  feature_key: string
  rule_id: number | null
  old_value_json: string | null
  new_value_json: string
  reason: string
  changed_by: string
  changed_at: string
  request_id: string | null
}

export type RevisionInsert = Omit<RevisionRow, 'id' | 'changed_at'>

export interface RevisionsRepository {
  insert(entry: RevisionInsert, trx?: Knex.Transaction): Promise<RevisionRow>
  listByProduct(productId: number, limit?: number): Promise<RevisionRow[]>
  getByRevision(productId: number, revision: number): Promise<RevisionRow[]>
}

export class DefaultRevisionsRepository implements RevisionsRepository {
  constructor(private readonly db: Knex) {}

  async insert(entry: RevisionInsert, trx?: Knex.Transaction): Promise<RevisionRow> {
    const qb = trx ? trx<RevisionRow>('config_revisions') : this.db<RevisionRow>('config_revisions')
    const result = await qb.insert(entry).returning('id')
    const id = typeof result[0] === 'object' ? (result[0] as { id: number }).id : result[0] as number

    const inserted = await (trx ? trx<RevisionRow>('config_revisions') : this.db<RevisionRow>('config_revisions'))
      .where({ id })
      .first()

    if (!inserted) {
      throw new Error(`Failed to retrieve revision entry after insert (id=${id})`)
    }
    return inserted
  }

  async listByProduct(productId: number, limit = 50): Promise<RevisionRow[]> {
    return this.db<RevisionRow>('config_revisions')
      .where({ product_id: productId })
      .orderBy('revision', 'desc')
      .limit(limit)
  }

  async getByRevision(productId: number, revision: number): Promise<RevisionRow[]> {
    return this.db<RevisionRow>('config_revisions')
      .where({ product_id: productId, revision })
  }
}
