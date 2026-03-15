import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('feature_definitions', (table) => {
    table.increments('id')
    table.integer('product_id').notNullable()
    table.foreign('product_id').references('id').inTable('products')
    table.string('feature_key').notNullable()
    // JSON stored as text for SQLite compatibility
    table.text('default_entry_json').notNullable()
    table.text('payload_schema_json').nullable()
    table.string('manifest_owner').nullable()
    table.string('source_priority_mode').nullable()
    table.string('delivery_mode').nullable()
    table.string('manifest_hash').nullable()
    table.string('status').notNullable().defaultTo('active')
    table.timestamp('created_at').defaultTo(knex.fn.now())
    table.timestamp('updated_at').defaultTo(knex.fn.now())

    table.unique(['product_id', 'feature_key'])
    table.index(['product_id', 'status'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('feature_definitions')
}
