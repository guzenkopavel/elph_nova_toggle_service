import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { parseEnv } from '../config/env'

export function createKnex(databaseUrl: string): Knex {
  if (databaseUrl.startsWith('sqlite:')) {
    const filename = databaseUrl.slice('sqlite:'.length)
    return KnexLib({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      migrations: {
        directory: path.join(__dirname, 'migrations'),
        extension: 'ts',
        loadExtensions: ['.ts'],
      },
    })
  }

  return KnexLib({
    client: 'pg',
    connection: databaseUrl,
    migrations: {
      directory: path.join(__dirname, 'migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  })
}

const env = parseEnv()
export const db = createKnex(env.DATABASE_URL)
