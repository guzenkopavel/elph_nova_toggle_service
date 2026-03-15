import Fastify, { FastifyInstance } from 'fastify'
import healthPlugin from './modules/health/index'
import { createLogger } from './shared/logger'
import type { Env } from './config/env'
import type { ManifestRegistry } from './modules/manifest/registry'

export interface AppOptions {
  logger?: boolean | object
  env?: Pick<Env, 'LOG_LEVEL' | 'TRUST_PROXY'>
  readyChecks?: Array<() => Promise<void>>
  manifestRegistry?: ManifestRegistry
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

  return app
}
