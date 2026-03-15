import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('products', (table) => {
    table.increments('id')
    table.string('name').notNullable()
    table.integer('ttl_seconds').notNullable().defaultTo(3600)
    table.string('manifest_hash').nullable()
    table.integer('current_revision').notNullable().defaultTo(0)
    table.unique(['name'])
    table.timestamp('created_at').defaultTo(knex.fn.now())
    table.timestamp('updated_at').defaultTo(knex.fn.now())
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('products')
}
