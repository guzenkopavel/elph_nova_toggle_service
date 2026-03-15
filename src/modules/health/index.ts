import type { FastifyInstance, FastifyPluginAsync } from 'fastify'

export type ReadyCheck = () => Promise<void>

export interface HealthPluginOptions {
  readyChecks?: ReadyCheck[]
}

const healthPlugin: FastifyPluginAsync<HealthPluginOptions> = async (
  fastify: FastifyInstance,
  options: HealthPluginOptions,
) => {
  const readyChecks = options.readyChecks ?? []

  fastify.get('/health/live', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' })
  })

  fastify.get('/health/ready', async (_request, reply) => {
    if (readyChecks.length === 0) {
      return reply.status(200).send({ status: 'ok' })
    }

    const results = await Promise.allSettled(readyChecks.map((check) => check()))
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )

    if (failed.length > 0) {
      const errors = failed.map((r) => String(r.reason))
      return reply.status(503).send({ status: 'error', errors })
    }

    return reply.status(200).send({ status: 'ok' })
  })
}

export default healthPlugin
