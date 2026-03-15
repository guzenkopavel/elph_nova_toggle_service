import path from 'path'
import { parseEnv } from './config/env'
import { createLogger } from './shared/logger'
import { createApp } from './app'
import { db as defaultDb } from './db/knex'
import { loadManifest } from './modules/manifest/loader'
import { ManifestRegistry } from './modules/manifest/registry'
import { ManifestSyncService } from './modules/manifest/sync'
import { DefaultDefinitionsRepository } from './modules/definitions/repository'
import { DefaultProductsRepository } from './modules/products/repository'

async function start() {
  try {
    const env = parseEnv()
    const logger = createLogger({ LOG_LEVEL: env.LOG_LEVEL })

    const manifestPath = path.resolve(env.MANIFEST_PATH)
    const { manifest, hash, remoteCapableFeatures } = loadManifest(manifestPath)

    const manifestRegistry = new ManifestRegistry()
    manifestRegistry.load(remoteCapableFeatures, hash)

    const definitionsRepo = new DefaultDefinitionsRepository(defaultDb)
    const productsRepo = new DefaultProductsRepository(defaultDb)
    const syncService = new ManifestSyncService(defaultDb, definitionsRepo, productsRepo)
    const driftCheck = syncService.driftReadyCheck(manifest.product.id, hash)

    const app = await createApp({
      env,
      readyChecks: [driftCheck],
      manifestRegistry,
      // Reuse the already-constructed logger — avoids duplicating redact config
      logger: logger as object,
    })

    let closing = false
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT']
    signals.forEach((signal) => {
      process.once(signal, async () => {
        if (closing) return
        closing = true
        logger.info({ signal }, 'Received shutdown signal')
        try {
          await app.close()
          logger.info('Server closed gracefully')
          process.exit(0)
        } catch (err) {
          logger.error(err, 'Error during graceful shutdown')
          process.exit(1)
        }
      })
    })

    await app.listen({ port: env.PORT, host: '0.0.0.0' })
  } catch (err) {
    console.error('Fatal startup error:', err)
    process.exit(1)
  }
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
