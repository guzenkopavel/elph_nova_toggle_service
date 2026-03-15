import type { FastifyPluginAsync } from 'fastify'
import type { ConfigResolutionService } from '../config-resolution/service'
import type { Platform } from '../config-resolution/types'
import type { TokenVerifier } from '../auth/token-verifier'
import { TokenInvalidError, InfraError } from '../auth/token-verifier'
import { featureConfigHeaders, featureConfigResponse200 } from './schemas'

export interface PublicPluginOptions {
  resolutionService: ConfigResolutionService
  productId: number
  tokenVerifier: TokenVerifier
}

const publicPlugin: FastifyPluginAsync<PublicPluginOptions> = async (fastify, options) => {
  const { resolutionService, productId, tokenVerifier } = options

  fastify.get('/api/v1/feature-config', {
    schema: {
      headers: featureConfigHeaders,
      response: {
        200: featureConfigResponse200,
      },
    },
  }, async (request, reply) => {
    const headers = request.headers as {
      platform: Platform
      appname: string
      appversion: string
      authorization?: string
    }

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
      platform: headers.platform,
      appVersion: headers.appversion,
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

export default publicPlugin
