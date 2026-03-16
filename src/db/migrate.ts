/**
 * Standalone migration runner for production use.
 * Called from docker-entrypoint.sh before starting the server.
 * Compiled to dist/src/db/migrate.js — uses __dirname to locate compiled migrations.
 */
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'

async function migrate(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'] ?? 'sqlite:./data/feature-config.db'

  // In production (compiled), migrations are .js files next to this file.
  // In development (tsx), they are .ts files.
  const isCompiled = __filename.endsWith('.js')
  const migrations: Knex.MigratorConfig = isCompiled
    ? { directory: path.join(__dirname, 'migrations') }
    : { directory: path.join(__dirname, 'migrations'), extension: 'ts', loadExtensions: ['.ts'] }

  let config: Knex.Config
  if (databaseUrl.startsWith('sqlite:')) {
    config = {
      client: 'better-sqlite3',
      connection: { filename: databaseUrl.slice('sqlite:'.length) },
      useNullAsDefault: true,
      migrations,
    }
  } else {
    config = { client: 'pg', connection: databaseUrl, migrations }
  }

  const db = KnexLib(config)
  try {
    const [batchNo, applied] = await db.migrate.latest()
    if (applied.length === 0) {
      console.log('Database already up to date')
    } else {
      console.log(`Applied batch ${batchNo}:`, applied)
    }
  } finally {
    await db.destroy()
  }
}

migrate().catch((err: unknown) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
