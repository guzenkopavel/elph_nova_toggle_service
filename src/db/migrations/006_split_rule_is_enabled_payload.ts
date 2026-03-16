import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('feature_rules', (table) => {
    // Dedicated boolean column for the on/off toggle
    table.boolean('is_enabled').notNullable().defaultTo(true)
    // Separate payload column (extra parameters beyond the flag itself)
    table.text('payload_json').nullable()
  })

  // Migrate existing data: extract isEnabled from entry_json
  // Detect dialect: 'pg' / 'postgresql' vs 'sqlite3' / 'better-sqlite3'
  const dialect = String((knex as unknown as { client?: { config?: { client?: string } } }).client?.config?.client ?? '')
  const isPostgres = dialect.includes('pg')

  if (isPostgres) {
    await knex.raw(`
      UPDATE feature_rules
      SET
        is_enabled = COALESCE((entry_json::jsonb->>'isEnabled')::boolean, true),
        payload_json = CASE
          WHEN (entry_json::jsonb - 'isEnabled') = '{}'::jsonb THEN NULL
          ELSE (entry_json::jsonb - 'isEnabled')::text
        END
    `)
  } else {
    // SQLite: json_extract returns 1/0 for booleans
    await knex.raw(`
      UPDATE feature_rules
      SET is_enabled = CASE WHEN json_extract(entry_json, '$.isEnabled') = 1 THEN 1 ELSE 0 END
    `)
    // payload_json stays NULL for existing rules (no payload beyond isEnabled in old data)
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('feature_rules', (table) => {
    table.dropColumn('is_enabled')
    table.dropColumn('payload_json')
  })
}
