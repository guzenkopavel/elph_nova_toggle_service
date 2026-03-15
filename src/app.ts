import Fastify, { FastifyInstance } from 'fastify'
import healthPlugin from './modules/health/index'
import publicPlugin from './modules/public/index'
import adminPlugin from './modules/admin/routes'
import { createLogger } from './shared/logger'
import type { Env } from './config/env'
import type { ManifestRegistry } from './modules/manifest/registry'
import type { ConfigResolutionService } from './modules/config-resolution/service'
import type { TokenVerifier } from './modules/auth/token-verifier'
import type { AdminRulesService } from './modules/admin/service'

export interface PublicOptions {
  resolutionService: ConfigResolutionService
  productId: number
  tokenVerifier: TokenVerifier
}

export interface AdminOptions {
  service: AdminRulesService
  verifier: TokenVerifier
  productId: number
}

export interface AppOptions {
  logger?: boolean | object
  env?: Pick<Env, 'LOG_LEVEL' | 'TRUST_PROXY'>
  readyChecks?: Array<() => Promise<void>>
  manifestRegistry?: ManifestRegistry
  publicOptions?: PublicOptions
  adminOptions?: AdminOptions
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const loggerConfig =
    options.logger === false
      ? false
      : options.logger !== undefined
        ? options.logger
        : createLogger({ LOG_LEVEL: options.env?.LOG_LEVEL ?? 'info' })

  const app = Fastify({
    logger: loggerConfig,
    trustProxy: options.env?.TRUST_PROXY ?? false,
  })

  const allReadyChecks = [...(options.readyChecks ?? [])]

  if (options.manifestRegistry) {
    allReadyChecks.push(options.manifestRegistry.readyCheck())
  }

  await app.register(healthPlugin, {
    readyChecks: allReadyChecks,
  })

  if (options.publicOptions) {
    await app.register(publicPlugin, options.publicOptions)
  }

  if (options.adminOptions) {
    await app.register(adminPlugin, options.adminOptions)
  }

  return app
}
