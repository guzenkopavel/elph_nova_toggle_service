import path from 'path'
import Fastify, { FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyCsrf from '@fastify/csrf-protection'
import fastifyFormBody from '@fastify/formbody'
import fastifyView from '@fastify/view'
import nunjucks from 'nunjucks'
import healthPlugin from './modules/health/index'
import publicPlugin from './modules/public/index'
import adminPlugin from './modules/admin/routes'
import adminUiPlugin from './modules/admin/ui-routes'
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
  registry?: ManifestRegistry
}

export interface AppOptions {
  logger?: boolean | object
  env?: Pick<Env, 'LOG_LEVEL' | 'TRUST_PROXY' | 'ADMIN_COOKIE_SECRET'>
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

    // Register UI plugins only when registry is provided
    const { registry } = options.adminOptions
    if (registry) {
      await app.register(fastifyCookie, {
        secret: options.env?.ADMIN_COOKIE_SECRET ?? 'dev-insecure-cookie-secret-change-in-production',
      })
      await app.register(fastifyCsrf, { sessionPlugin: '@fastify/cookie' })
      await app.register(fastifyFormBody)
      await app.register(fastifyView, {
        engine: { nunjucks },
        templates: path.join(__dirname, 'views'),
        options: {
          autoescape: true,
        },
      })

      await app.register(adminUiPlugin, {
        service: options.adminOptions.service,
        verifier: options.adminOptions.verifier,
        productId: options.adminOptions.productId,
        registry,
      })
    }
  }

  return app
}
