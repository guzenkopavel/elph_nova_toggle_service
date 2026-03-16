import type { Knex } from 'knex'
import type { DefinitionsRepository } from '../definitions/repository'
import type { ProductsRepository } from '../products/repository'
import { withTransaction } from '../../db/transaction'
import type { ManifestDefinition } from './registry'
import type { ConfigResolutionService } from '../config-resolution/service.js'

export interface SyncManifestInput {
  productName: string
  manifestHash: string
  definitions: ManifestDefinition[]
}

export interface SyncManifestResult {
  productId: number
  upserted: number
  archived: number
  manifestHash: string
}

export class ManifestSyncService {
  constructor(
    private readonly db: Knex,
    private readonly definitionsRepo: DefinitionsRepository,
    private readonly productsRepo: ProductsRepository,
    private readonly resolutionService?: Pick<ConfigResolutionService, 'invalidateCache'>,
  ) {}

  async sync(input: SyncManifestInput): Promise<SyncManifestResult> {
    const result = await withTransaction(this.db, async (trx) => {
      const product = await this.productsRepo.upsertByName(input.productName, 3600, trx)

      const existing = await trx('feature_definitions')
        .where({ product_id: product.id, status: 'active' })
        .select('feature_key')
      const existingKeys = new Set(
        existing.map((r: { feature_key: string }) => r.feature_key),
      )

      const incomingKeys = new Set<string>()
      let upserted = 0
      for (const def of input.definitions) {
        await this.definitionsRepo.upsert(
          {
            product_id: product.id,
            feature_key: def.feature_key,
            default_entry_json: def.default_entry_json,
            payload_schema_json: def.payload_schema_json,
            manifest_owner: def.owner ?? null,
            source_priority_mode: def.source_priority_mode,
            delivery_mode: def.delivery_mode,
            manifest_hash: input.manifestHash,
            status: 'active',
          },
          trx,
        )
        incomingKeys.add(def.feature_key)
        upserted++
      }

      const toArchive = [...existingKeys].filter((k) => !incomingKeys.has(k))
      for (const key of toArchive) {
        await this.definitionsRepo.archive(product.id, key, trx)
        // Note: dependency edges referencing archived keys are intentionally kept in DB.
        // applyDependencyPropagation skips edges whose keys are absent from the resolved
        // feature map, so orphaned edges are harmless at resolution time.
      }

      await this.productsRepo.updateManifestHash(product.id, input.manifestHash, trx)

      return {
        productId: product.id,
        upserted,
        archived: toArchive.length,
        manifestHash: input.manifestHash,
      }
    })
    // Invalidate compiled snapshot cache after transaction commits.
    // Must run after withTransaction returns — never inside the transaction.
    this.resolutionService?.invalidateCache(result.productId)
    return result
  }

  driftReadyCheck(productName: string, expectedHash: string): () => Promise<void> {
    return async () => {
      const row = await this.db('products')
        .where({ name: productName })
        .select('manifest_hash')
        .first()
      if (!row) {
        throw new Error(
          `ManifestSyncService: product '${productName}' not found in DB — run sync-manifest first`,
        )
      }
      if (row.manifest_hash !== expectedHash) {
        throw new Error(
          `ManifestSyncService: manifest drift detected for '${productName}' — ` +
            `DB has hash ${row.manifest_hash ?? 'null'}, expected ${expectedHash}`,
        )
      }
    }
  }
}
