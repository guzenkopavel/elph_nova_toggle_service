import path from 'path'
import { parseEnv } from '../src/config/env'
import { createKnex } from '../src/db/knex'
import { DefaultDefinitionsRepository } from '../src/modules/definitions/repository'
import { DefaultProductsRepository } from '../src/modules/products/repository'
import { loadManifest } from '../src/modules/manifest/loader'
import { ManifestRegistry } from '../src/modules/manifest/registry'
import { ManifestSyncService } from '../src/modules/manifest/sync'

async function main() {
  const env = parseEnv()
  const manifestPath = path.resolve(env.MANIFEST_PATH)

  console.log(`Loading manifest from: ${manifestPath}`)
  const { manifest, hash, remoteCapableFeatures } = loadManifest(manifestPath)
  console.log(`Manifest v${manifest.manifestVersion}, product: ${manifest.product.name}`)
  console.log(`remoteCapable features: ${remoteCapableFeatures.length}`)
  console.log(`Manifest hash: ${hash}`)

  const registry = new ManifestRegistry()
  registry.load(remoteCapableFeatures, hash)

  const db = createKnex(env.DATABASE_URL)

  try {
    const definitionsRepo = new DefaultDefinitionsRepository(db)
    const productsRepo = new DefaultProductsRepository(db)
    const syncService = new ManifestSyncService(db, definitionsRepo, productsRepo)

    const result = await syncService.sync({
      productName: manifest.product.id,
      manifestHash: hash,
      definitions: registry.getAll(),
    })

    console.log('Sync complete:')
    console.log(`  Product ID: ${result.productId}`)
    console.log(`  Upserted: ${result.upserted} definitions`)
    console.log(`  Archived: ${result.archived} definitions`)
    console.log(`  Hash: ${result.manifestHash}`)
  } finally {
    await db.destroy()
  }
}

main().catch((err) => {
  console.error('sync-manifest failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
