import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { parseEnv } from '../config/env'

function migrationsConfig(): Knex.MigratorConfig {
  // When running from compiled JS (production), migration files are also .js.
  // When running via tsx in development, they're .ts.
  const isCompiled = __filename.endsWith('.js')
  return isCompiled
    ? { directory: path.join(__dirname, 'migrations') }
    : { directory: path.join(__dirname, 'migrations'), extension: 'ts', loadExtensions: ['.ts'] }
}

export function createKnex(databaseUrl: string): Knex {
  if (databaseUrl.startsWith('sqlite:')) {
    const filename = databaseUrl.slice('sqlite:'.length)
    return KnexLib({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      migrations: migrationsConfig(),
    })
  }

  return KnexLib({
    client: 'pg',
    connection: databaseUrl,
    migrations: migrationsConfig(),
  })
}

const env = parseEnv()
export const db = createKnex(env.DATABASE_URL)
