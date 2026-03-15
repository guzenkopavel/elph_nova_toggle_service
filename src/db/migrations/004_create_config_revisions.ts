import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('config_revisions', (table) => {
    table.increments('id')
    table.integer('product_id').notNullable()
    table.foreign('product_id').references('id').inTable('products')
    table.integer('revision').notNullable()
    // e.g. 'rule_created' | 'rule_updated' | 'rule_disabled'
    table.string('change_type').notNullable()
    table.string('feature_key').notNullable()
    table.integer('rule_id').nullable()
    table.foreign('rule_id').references('id').inTable('feature_rules')
    // JSON stored as text for SQLite compatibility
    table.text('old_value_json').nullable()
    table.text('new_value_json').notNullable()
    table.text('reason').notNullable()
    table.string('changed_by').notNullable()
    table.timestamp('changed_at').defaultTo(knex.fn.now())
    table.string('request_id').nullable()

    table.index(['product_id', 'revision'])
    table.index(['product_id', 'feature_key'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('config_revisions')
}
