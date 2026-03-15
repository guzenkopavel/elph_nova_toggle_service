import path from 'path'
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyCsrf from '@fastify/csrf-protection'
import fastifyFormBody from '@fastify/formbody'
import fastifyView from '@fastify/view'
import fastifyHelmet from '@fastify/helmet'
import fastifyCors from '@fastify/cors'
import fastifyRateLimit from '@fastify/rate-limit'
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

export interface RateLimitOptions {
  enabled?: boolean
  publicMax?: number
  publicWindow?: number
  adminMax?: number
  adminWindow?: number
}

export interface AppOptions {
  logger?: boolean | object
  env?: Pick<Env, 'LOG_LEVEL' | 'TRUST_PROXY' | 'TRUSTED_PROXY_IPS' | 'ADMIN_COOKIE_SECRET' | 'CORS_ALLOWED_ORIGINS' | 'RATE_LIMIT_PUBLIC_MAX' | 'RATE_LIMIT_ADMIN_MAX'>
  readyChecks?: Array<() => Promise<void>>
  manifestRegistry?: ManifestRegistry
  publicOptions?: PublicOptions
  adminOptions?: AdminOptions
  rateLimits?: RateLimitOptions
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const loggerConfig =
    options.logger === false
      ? false
      : options.logger !== undefined
        ? options.logger
        : createLogger({ LOG_LEVEL: options.env?.LOG_LEVEL ?? 'info' })

  const trustProxyValue = (() => {
    if (!options.env?.TRUST_PROXY) return false
    const ips = options.env.TRUSTED_PROXY_IPS
    if (!ips) return true // TRUST_PROXY=true but no specific IPs (dev/staging)
    return ips.split(',').map((s) => s.trim()).filter(Boolean) // specific IPs/CIDRs in production
  })()

  const app = Fastify({
    logger: loggerConfig,
    trustProxy: trustProxyValue,
  })

  // ─── Determine effective rate limit config ────────────────────────────────

  // In test env, default rate limits to disabled to avoid 429 in existing tests.
  // Hardening tests that explicitly pass { enabled: true } will override this.
  const isTestEnv = process.env['NODE_ENV'] === 'test'
  const rl: Required<RateLimitOptions> = {
    enabled: options.rateLimits?.enabled ?? !isTestEnv,
    publicMax: options.rateLimits?.publicMax ?? (options.env?.RATE_LIMIT_PUBLIC_MAX ?? 300),
    publicWindow: options.rateLimits?.publicWindow ?? 60_000,
    adminMax: options.rateLimits?.adminMax ?? (options.env?.RATE_LIMIT_ADMIN_MAX ?? 100),
    adminWindow: options.rateLimits?.adminWindow ?? 60_000,
  }

  // ─── Determine CORS origins ───────────────────────────────────────────────
  // "none" is an explicit sentinel meaning deny all cross-origin requests (no cors plugin).
  // An absent value is treated the same as "none" (also no cors plugin).

  const rawCorsOrigins = options.env?.CORS_ALLOWED_ORIGINS ?? ''
  const corsOrigins = rawCorsOrigins === 'none'
    ? []
    : rawCorsOrigins.split(',').map((s) => s.trim()).filter(Boolean)

  // ─── Global security plugins ──────────────────────────────────────────────

  // Helmet: security headers on all routes.
  // CSP is disabled globally — admin UI sets its own inline via template if needed.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })

  // CORS: register globally using a delegator that restricts it to /api/* paths only.
  // Admin routes (/admin/*) and health routes never receive CORS headers.
  if (corsOrigins.length > 0) {
    await app.register(fastifyCors, {
      delegator: (req: FastifyRequest, cb) => {
        const url: string = (req.raw?.url ?? req.url ?? '')
        if (!url.startsWith('/api/')) {
          // Disable CORS for non-public routes (admin, health)
          cb(null, { origin: false })
        } else {
          cb(null, { origin: corsOrigins, methods: ['GET', 'OPTIONS'], credentials: false })
        }
      },
    })
  }

  // Rate limit: register globally with public limits as the default.
  // Health routes are exempt via config: { rateLimit: false } in the health plugin.
  // Admin routes get a per-route override via config: { rateLimit: { ... } } in admin plugins.
  // When disabled (test env by default), no rate limit is registered at all.
  if (rl.enabled) {
    await app.register(fastifyRateLimit, {
      global: true,
      max: rl.publicMax,
      timeWindow: rl.publicWindow,
      keyGenerator: (req) => req.ip,
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${ctx.after}.`,
      }),
    })
  }

  // ─── Infrastructure plugins (all use fastify-plugin = break encapsulation) ─

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

  // ─── Route plugins ────────────────────────────────────────────────────────

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
    await app.register(adminPlugin, {
      ...options.adminOptions,
      rateLimitConfig: rl.enabled
        ? { max: rl.adminMax, timeWindow: rl.adminWindow }
        : undefined,
    })

    // Register UI plugins only when registry is provided
    const { registry } = options.adminOptions
    if (registry) {
      await app.register(adminUiPlugin, {
        service: options.adminOptions.service,
        verifier: options.adminOptions.verifier,
        productId: options.adminOptions.productId,
        registry,
        rateLimitConfig: rl.enabled
          ? { max: rl.adminMax, timeWindow: rl.adminWindow }
          : undefined,
      })
    }
  }

  return app
}
