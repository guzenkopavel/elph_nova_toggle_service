import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('feature_rules', (table) => {
    table.increments('id')
    table.integer('product_id').notNullable()
    table.foreign('product_id').references('id').inTable('products')
    table.string('feature_key').notNullable()
    // 'all' | 'anonymous' | 'authenticated'
    table.string('audience').notNullable().defaultTo('all')
    // 'all' | 'ios' | 'android' | 'web' | 'desktop'
    table.string('platform').notNullable().defaultTo('all')
    table.string('min_app_version').nullable()
    table.string('max_app_version').nullable()
    // JSON stored as text for SQLite compatibility
    table.text('entry_json').notNullable()
    table.boolean('is_active').notNullable().defaultTo(true)
    table.string('created_by').nullable()
    table.string('updated_by').nullable()
    table.timestamp('created_at').defaultTo(knex.fn.now())
    table.timestamp('updated_at').defaultTo(knex.fn.now())

    // No UNIQUE constraint at DB level — specificity overlap enforcement is handled
    // by the resolution service (Task 6) which applies a most-specific-wins policy.
    table.index(['product_id', 'feature_key', 'is_active'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('feature_rules')
}
