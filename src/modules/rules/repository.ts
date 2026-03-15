import type { Knex } from 'knex'

export interface RuleRow {
  id: number
  product_id: number
  feature_key: string
  audience: 'all' | 'anonymous' | 'authenticated'
  platform: 'all' | 'ios' | 'android' | 'web' | 'desktop'
  min_app_version: string | null
  max_app_version: string | null
  entry_json: string
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type RuleInsert = Omit<RuleRow, 'id' | 'created_at' | 'updated_at'>
export type RuleUpdate = Partial<Omit<RuleRow, 'id' | 'created_at'>>

export interface RulesRepository {
  create(rule: RuleInsert, trx?: Knex.Transaction): Promise<RuleRow>
  update(id: number, fields: RuleUpdate, trx?: Knex.Transaction): Promise<RuleRow>
  disable(id: number, updatedBy: string, trx?: Knex.Transaction): Promise<void>
  findById(id: number): Promise<RuleRow | undefined>
  listActiveByKey(productId: number, featureKey: string): Promise<RuleRow[]>
  listAllActive(productId: number, trx?: Knex.Transaction): Promise<RuleRow[]>
}

export class DefaultRulesRepository implements RulesRepository {
  constructor(private readonly db: Knex) {}

  // SQLite stores boolean columns as integer (0/1). Coerce to JS boolean so
  // callers always receive the typed RuleRow regardless of the DB driver.
  private coerce(row: RuleRow): RuleRow {
    return { ...row, is_active: Boolean(row.is_active) }
  }

  async create(rule: RuleInsert, trx?: Knex.Transaction): Promise<RuleRow> {
    const qb = trx ? trx<RuleRow>('feature_rules') : this.db<RuleRow>('feature_rules')
    const result = await qb.insert(rule).returning('id')
    const id = typeof result[0] === 'object' ? (result[0] as { id: number }).id : result[0] as number

    const inserted = await (trx ? trx<RuleRow>('feature_rules') : this.db<RuleRow>('feature_rules'))
      .where({ id })
      .first()

    if (!inserted) {
      throw new Error(`Failed to retrieve rule after insert (id=${id})`)
    }
    return this.coerce(inserted)
  }

  async update(id: number, fields: RuleUpdate, trx?: Knex.Transaction): Promise<RuleRow> {
    const qb = trx ? trx<RuleRow>('feature_rules') : this.db<RuleRow>('feature_rules')
    await qb.where({ id }).update({
      ...fields,
      updated_at: (trx ?? this.db).fn.now() as unknown as string,
    })

    const updated = await (trx ? trx<RuleRow>('feature_rules') : this.db<RuleRow>('feature_rules'))
      .where({ id })
      .first()

    if (!updated) {
      throw new Error(`Rule not found after update (id=${id})`)
    }
    return this.coerce(updated)
  }

  async disable(id: number, updatedBy: string, trx?: Knex.Transaction): Promise<void> {
    const qb = trx ? trx<RuleRow>('feature_rules') : this.db<RuleRow>('feature_rules')
    await qb.where({ id }).update({
      is_active: false,
      updated_by: updatedBy,
      updated_at: (trx ?? this.db).fn.now() as unknown as string,
    })
  }

  async findById(id: number): Promise<RuleRow | undefined> {
    const row = await this.db<RuleRow>('feature_rules').where({ id }).first()
    return row ? this.coerce(row) : undefined
  }

  async listActiveByKey(productId: number, featureKey: string): Promise<RuleRow[]> {
    const rows = await this.db<RuleRow>('feature_rules')
      .where({ product_id: productId, feature_key: featureKey, is_active: true })
    return rows.map((r) => this.coerce(r))
  }

  async listAllActive(productId: number, trx?: Knex.Transaction): Promise<RuleRow[]> {
    const qb = (trx ?? this.db)<RuleRow>('feature_rules')
    const rows = await qb.where({ product_id: productId, is_active: true }).orderBy('id', 'asc').select('*')
    return rows.map((r) => this.coerce(r))
  }
}
