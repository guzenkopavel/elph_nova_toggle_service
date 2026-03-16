import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('flag_dependencies', (table) => {
    table.increments('id')
    table.integer('product_id').notNullable()
    table.foreign('product_id').references('id').inTable('products')
    table.string('parent_feature_key').notNullable()
    table.string('child_feature_key').notNullable()
    table.text('reason').nullable()
    table.timestamp('created_at').defaultTo(knex.fn.now())

    table.unique(['product_id', 'parent_feature_key', 'child_feature_key'])
    table.index(['product_id'])
    table.index(['product_id', 'child_feature_key'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('flag_dependencies')
}
