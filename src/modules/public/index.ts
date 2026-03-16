import { z } from 'zod'
import type { FastifyPluginAsync } from 'fastify'
import type { ConfigResolutionService } from '../config-resolution/service'
import type { Platform } from '../config-resolution/types'
import type { TokenVerifier } from '../auth/token-verifier'
import { TokenInvalidError } from '../auth/token-verifier'
import { featureConfigHeaders, featureConfigResponse200 } from './schemas'

export interface PublicPluginOptions {
  resolutionService: ConfigResolutionService
  productId: number
  tokenVerifier: TokenVerifier
}

const flagsQuerySchema = z.object({
  platform: z.enum(['ios', 'android', 'web', 'desktop']).default('ios'),
  appversion: z.string().min(1).default('1.0.0'),
})

const publicPlugin: FastifyPluginAsync<PublicPluginOptions> = async (fastify, options) => {
  const { resolutionService, productId, tokenVerifier } = options

  // ─── GET /flags — browser-accessible HTML page with resolved feature flags ──

  fastify.get('/flags', async (request, reply) => {
    const parseResult = flagsQuerySchema.safeParse(request.query)
    const { platform, appversion } = parseResult.success
      ? parseResult.data
      : { platform: 'ios' as const, appversion: '1.0.0' }

    let features: Record<string, unknown> | undefined
    let revision: number | undefined
    let error: string | undefined

    try {
      const snapshot = await resolutionService.resolveConfig(productId, {
        authState: 'anonymous',
        platform,
        appVersion: appversion,
      })
      features = snapshot.features as Record<string, unknown>
      revision = snapshot.revision
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error'
    }

    const html = await reply.viewAsync('flags.njk', { platform, appversion, features, revision, error })
    return reply.type('text/html').send(html)
  })

  // ─── GET /api/v1/feature-config ─────────────────────────────────────────────

  fastify.get('/api/v1/feature-config', {
    schema: {
      headers: featureConfigHeaders,
      response: {
        200: featureConfigResponse200,
      },
    },
  }, async (request, reply) => {
    const headers = request.headers as {
      platform?: Platform
      appname?: string
      appversion?: string
      'x-api-version'?: string
      'user-agent'?: string
      authorization?: string
    }

    const appVersion = (headers.appversion ?? headers['x-api-version'] ?? '1.0.0').trim()
    const platform: Platform = headers.platform ?? detectPlatformFromUA(headers['user-agent'] ?? '')

    let authResult: Awaited<ReturnType<TokenVerifier['verify']>>
    try {
      authResult = await tokenVerifier.verify(headers.authorization)
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      // InfraError or unexpected error → 503
      request.log.error({ err }, 'Token verification infrastructure failure')
      return reply.code(503).send({ error: 'Service temporarily unavailable' })
    }

    const ctx = {
      authState: authResult.state,
      platform,
      appVersion,
    }

    const snapshot = await resolutionService.resolveConfig(productId, ctx)

    return reply
      .header('Cache-Control', 'no-store')
      .code(200)
      .send({
        version: snapshot.revision,
        ttl: snapshot.ttl,
        features: snapshot.features,
      })
  })
}

function detectPlatformFromUA(ua: string): Platform {
  const s = ua.toLowerCase()
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ipod')) return 'ios'
  if (s.includes('android')) return 'android'
  return 'web'
}

export default publicPlugin
