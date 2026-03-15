import type { Knex } from 'knex'

export interface DefinitionRow {
  id: number
  product_id: number
  feature_key: string
  default_entry_json: string
  payload_schema_json: string | null
  manifest_owner: string | null
  source_priority_mode: string | null
  delivery_mode: string | null
  manifest_hash: string | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export type DefinitionInsert = Omit<DefinitionRow, 'id' | 'created_at' | 'updated_at'>

export type DefinitionUpsertInput = Omit<DefinitionRow, 'id' | 'created_at' | 'updated_at'> & {
  manifest_hash: string  // override nullable to required on insert
}

export interface DefinitionsRepository {
  upsert(row: DefinitionUpsertInput, trx?: Knex.Transaction): Promise<DefinitionRow>
  findByKey(productId: number, featureKey: string): Promise<DefinitionRow | undefined>
  listActive(productId: number): Promise<DefinitionRow[]>
  archive(productId: number, featureKey: string, trx?: Knex.Transaction): Promise<void>
}

export class DefaultDefinitionsRepository implements DefinitionsRepository {
  constructor(private readonly db: Knex) {}

  async upsert(row: DefinitionUpsertInput, trx?: Knex.Transaction): Promise<DefinitionRow> {
    const qb = trx ? trx<DefinitionRow>('feature_definitions') : this.db<DefinitionRow>('feature_definitions')

    await qb
      .insert(row)
      .onConflict(['product_id', 'feature_key'])
      .merge()

    const result = await (trx ? trx<DefinitionRow>('feature_definitions') : this.db<DefinitionRow>('feature_definitions'))
      .where({ product_id: row.product_id, feature_key: row.feature_key })
      .first()

    if (!result) {
      throw new Error(`Failed to retrieve definition after upsert (product_id=${row.product_id}, feature_key=${row.feature_key})`)
    }
    return result
  }

  async findByKey(productId: number, featureKey: string): Promise<DefinitionRow | undefined> {
    return this.db<DefinitionRow>('feature_definitions')
      .where({ product_id: productId, feature_key: featureKey })
      .first()
  }

  async listActive(productId: number): Promise<DefinitionRow[]> {
    return this.db<DefinitionRow>('feature_definitions')
      .where({ product_id: productId, status: 'active' })
  }

  async archive(productId: number, featureKey: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ? trx<DefinitionRow>('feature_definitions') : this.db<DefinitionRow>('feature_definitions')
    await qb
      .where({ product_id: productId, feature_key: featureKey })
      .update({
        status: 'archived',
        updated_at: (trx ?? this.db).fn.now() as unknown as string,
      })
  }
}
