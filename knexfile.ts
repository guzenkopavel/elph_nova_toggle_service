import type { Knex } from 'knex'

function buildConfig(databaseUrl: string): Knex.Config {
  if (databaseUrl.startsWith('sqlite:')) {
    const filename = databaseUrl.slice('sqlite:'.length)
    return {
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      migrations: {
        directory: './src/db/migrations',
        extension: 'ts',
        loadExtensions: ['.ts'],
      },
    }
  }

  return {
    client: 'pg',
    connection: databaseUrl,
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  }
}

const databaseUrl = process.env['DATABASE_URL'] ?? 'sqlite:./data/feature-config.db'

const config: Record<string, Knex.Config> = {
  development: buildConfig(databaseUrl),
  staging: buildConfig(databaseUrl),
  production: buildConfig(databaseUrl),
}

// CommonJS export for Knex CLI compatibility (knex CLI uses require())
module.exports = config
