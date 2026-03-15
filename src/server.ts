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
import { DefaultRulesRepository } from './modules/rules/repository'
import { DefaultRevisionsRepository } from './modules/revisions/repository'
import { ConfigResolutionService } from './modules/config-resolution/service'
import { AdminRulesService } from './modules/admin/service'
import { createTokenVerifier } from './modules/auth/token-verifier'

const SHUTDOWN_TIMEOUT_MS = parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '10000', 10)

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
    const driftCheck = syncService.driftReadyCheck(env.DEFAULT_PRODUCT_ID, hash)

    // Resolve numeric productId from the product name. upsertByName is idempotent —
    // it inserts if absent (handles first run before sync-manifest) and returns the row.
    // sync-manifest is still required before production use to populate definitions.
    const productRow = await productsRepo.upsertByName(env.DEFAULT_PRODUCT_ID)
    const productId = productRow.id
    logger.info({ productName: env.DEFAULT_PRODUCT_ID, productId }, 'Resolved product')

    const rulesRepo = new DefaultRulesRepository(defaultDb)
    const revisionsRepo = new DefaultRevisionsRepository(defaultDb)
    const resolutionService = new ConfigResolutionService(productsRepo, definitionsRepo, rulesRepo)

    const adminService = new AdminRulesService(
      defaultDb,
      manifestRegistry,
      rulesRepo,
      productsRepo,
      revisionsRepo,
      resolutionService,
    )

    const tokenVerifier = createTokenVerifier({
      jwksUri: env.SSO_JWKS_URI,
      issuer: env.SSO_ISSUER,
      audience: env.SSO_AUDIENCE,
      jwksTimeoutMs: env.SSO_JWKS_TIMEOUT_MS,
    })

    const app = await createApp({
      env,
      readyChecks: [driftCheck],
      manifestRegistry,
      // Reuse the already-constructed logger — avoids duplicating redact config
      logger: logger as object,
      publicOptions: { resolutionService, productId, tokenVerifier },
      adminOptions: { service: adminService, verifier: tokenVerifier, productId, registry: manifestRegistry },
    })

    let closing = false

    async function gracefulShutdown(signal: string) {
      if (closing) return
      closing = true

      logger.info({ signal }, 'Received shutdown signal')

      const watchdog = setTimeout(() => {
        logger.error('Graceful shutdown timed out, forcing exit')
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS)
      // Unref so the watchdog timer does not prevent the process from exiting normally
      watchdog.unref()

      try {
        await app.close()
        await defaultDb.destroy()
        logger.info('Graceful shutdown complete')
        clearTimeout(watchdog)
        process.exit(0)
      } catch (err) {
        logger.error({ err }, 'Error during graceful shutdown')
        process.exit(1)
      }
    }

    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT']
    signals.forEach((signal) => {
      process.once(signal, () => gracefulShutdown(signal))
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
