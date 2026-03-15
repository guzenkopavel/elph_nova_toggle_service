import type { Knex } from 'knex'

/**
 * withTransaction runs a callback inside a Knex transaction.
 * On success: commits and returns the result.
 * On error: rolls back and re-throws.
 */
export async function withTransaction<T>(
  db: Knex,
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return db.transaction(callback)
}
