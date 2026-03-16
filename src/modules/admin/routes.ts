import { z } from 'zod'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { AdminRulesService } from './service.js'
import type { TokenVerifier } from '../auth/token-verifier.js'
import { makeAdminAuthHook, ROLE_VIEWER, ROLE_EDITOR } from './auth.js'
import { ValidationError, ConflictError, NotFoundError } from './service.js'
import type { RequestContext } from '../config-resolution/types.js'

export interface AdminPluginRateLimitConfig {
  max: number
  timeWindow: number
}

export interface AdminPluginOptions {
  service: AdminRulesService
  verifier: TokenVerifier
  productId: number
  rateLimitConfig?: AdminPluginRateLimitConfig
}

// ─── Request body schemas ─────────────────────────────────────────────────────

const audienceSchema = z.enum(['all', 'anonymous', 'authenticated'])
const platformSchema = z.enum(['all', 'ios', 'android', 'web', 'desktop'])

// ─── Preview / revisions query schemas ────────────────────────────────────────

const previewQuerySchema = z.object({
  platform: z.enum(['ios', 'android', 'web', 'desktop']),
  appVersion: z.string().min(1),
  audience: z.enum(['anonymous', 'authenticated']).default('anonymous'),
})

const revisionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

const createRuleBodySchema = z.object({
  feature_key: z.string().min(1),
  audience: audienceSchema,
  platform: platformSchema,
  min_app_version: z.string().nullable().optional(),
  max_app_version: z.string().nullable().optional(),
  entry_json: z.record(z.unknown()),
  reason: z.string().min(1),
  expectedRevision: z.number().int().min(0),
})

const updateRuleBodySchema = z.object({
  audience: audienceSchema.optional(),
  platform: platformSchema.optional(),
  min_app_version: z.string().nullable().optional(),
  max_app_version: z.string().nullable().optional(),
  entry_json: z.record(z.unknown()).optional(),
  reason: z.string().min(1),
  expectedRevision: z.number().int().min(0),
})

const disableRuleBodySchema = z.object({
  reason: z.string().min(1),
  expectedRevision: z.number().int().min(0),
})

const addDependencyBodySchema = z.object({
  parentKey: z.string().min(1),
  childKey: z.string().min(1),
  reason: z.string().optional(),
  expectedRevision: z.number().int().min(0),
})

const removeDependencyBodySchema = z.object({
  expectedRevision: z.number().int().min(0),
})

// ─── Plugin ───────────────────────────────────────────────────────────────────

const adminPlugin: FastifyPluginAsync<AdminPluginOptions> = async (fastify, options) => {
  const { service, verifier, productId, rateLimitConfig } = options

  const viewerHook = makeAdminAuthHook(verifier, ROLE_VIEWER)
  const editorHook = makeAdminAuthHook(verifier, ROLE_EDITOR)

  // GET /admin/api/rules — list all active rules
  fastify.get('/admin/api/rules', {
    preHandler: viewerHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (_request, reply) => {
    const rules = await service.listRules(productId)
    return reply.code(200).send({ rules })
  })

  // GET /admin/api/rules/:id — get single rule
  fastify.get<{ Params: { id: string } }>('/admin/api/rules/:id', {
    preHandler: viewerHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const ruleId = parseInt(request.params.id, 10)
    if (isNaN(ruleId)) return reply.code(400).send({ error: 'Invalid rule id' })
    try {
      const rule = await service.getRule(ruleId)
      return reply.code(200).send({ rule })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })

  // POST /admin/api/rules — create rule
  fastify.post<{ Body: unknown }>('/admin/api/rules', {
    preHandler: editorHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const parseResult = createRuleBodySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.errors[0]?.message ?? 'Invalid request body' })
    }
    const body = parseResult.data
    try {
      const rule = await service.createRule({
        productId,
        feature_key: body.feature_key,
        audience: body.audience,
        platform: body.platform,
        min_app_version: body.min_app_version ?? null,
        max_app_version: body.max_app_version ?? null,
        entry_json: body.entry_json,
        reason: body.reason,
        expectedRevision: body.expectedRevision,
        changedBy: request.adminSub ?? 'unknown',
      })
      return reply.code(201).send({ rule })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })

  // PATCH /admin/api/rules/:id — update rule
  fastify.patch<{ Params: { id: string }; Body: unknown }>('/admin/api/rules/:id', {
    preHandler: editorHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const ruleId = parseInt(request.params.id, 10)
    if (isNaN(ruleId)) return reply.code(400).send({ error: 'Invalid rule id' })
    const parseResult = updateRuleBodySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.errors[0]?.message ?? 'Invalid request body' })
    }
    const body = parseResult.data
    try {
      const rule = await service.updateRule({
        productId,
        ruleId,
        audience: body.audience,
        platform: body.platform,
        min_app_version: body.min_app_version,
        max_app_version: body.max_app_version,
        entry_json: body.entry_json,
        reason: body.reason,
        expectedRevision: body.expectedRevision,
        changedBy: request.adminSub ?? 'unknown',
      })
      return reply.code(200).send({ rule })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })

  // DELETE /admin/api/rules/:id — disable rule
  fastify.delete<{ Params: { id: string }; Body: unknown }>('/admin/api/rules/:id', {
    preHandler: editorHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const ruleId = parseInt(request.params.id, 10)
    if (isNaN(ruleId)) return reply.code(400).send({ error: 'Invalid rule id' })
    const parseResult = disableRuleBodySchema.safeParse(request.body ?? {})
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.errors[0]?.message ?? 'Invalid request body' })
    }
    const body = parseResult.data
    try {
      await service.disableRule({
        productId,
        ruleId,
        reason: body.reason,
        expectedRevision: body.expectedRevision,
        changedBy: request.adminSub ?? 'unknown',
      })
      return reply.code(200).send({ ok: true })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })

  // GET /admin/api/preview — preview resolved config for given context
  fastify.get('/admin/api/preview', {
    preHandler: viewerHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const parseResult = previewQuerySchema.safeParse(request.query)
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.errors[0]?.message ?? 'Invalid query parameters' })
    }
    const { platform, appVersion, audience } = parseResult.data

    const ctx: RequestContext = {
      authState: audience,
      platform,
      appVersion,
    }

    try {
      const snapshot = await service.previewConfig(productId, ctx)
      return reply.code(200).send({
        version: snapshot.revision,
        ttl: snapshot.ttl,
        features: snapshot.features,
      })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })

  // GET /admin/api/dependencies — list all dependency edges
  fastify.get('/admin/api/dependencies', {
    preHandler: viewerHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (_request, reply) => {
    const deps = await service.listDependencies(productId)
    return reply.code(200).send({ dependencies: deps })
  })

  // POST /admin/api/dependencies — add dependency edge
  fastify.post<{ Body: unknown }>('/admin/api/dependencies', {
    preHandler: editorHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const parseResult = addDependencyBodySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.errors[0]?.message ?? 'Invalid request body' })
    }
    const body = parseResult.data
    try {
      const dep = await service.addDependency({
        productId,
        parentKey: body.parentKey,
        childKey: body.childKey,
        reason: body.reason,
        expectedRevision: body.expectedRevision,
        changedBy: request.adminSub ?? 'unknown',
      })
      return reply.code(201).send({ dependency: dep })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })

  // DELETE /admin/api/dependencies/:id — remove dependency edge
  fastify.delete<{ Params: { id: string }; Body: unknown }>('/admin/api/dependencies/:id', {
    preHandler: editorHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const depId = parseInt(request.params.id, 10)
    if (isNaN(depId)) return reply.code(400).send({ error: 'Invalid dependency id' })
    const parseResult = removeDependencyBodySchema.safeParse(request.body ?? {})
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.errors[0]?.message ?? 'Invalid request body' })
    }
    const body = parseResult.data
    try {
      await service.removeDependency({
        productId,
        depId,
        expectedRevision: body.expectedRevision,
        changedBy: request.adminSub ?? 'unknown',
      })
      return reply.code(200).send({ ok: true })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })

  // GET /admin/api/revisions — list recent revisions for the product
  fastify.get('/admin/api/revisions', {
    preHandler: viewerHook,
    ...(rateLimitConfig && { config: { rateLimit: rateLimitConfig } }),
  }, async (request, reply) => {
    const parseResult = revisionsQuerySchema.safeParse(request.query)
    if (!parseResult.success) {
      return reply.code(400).send({ error: parseResult.error.errors[0]?.message ?? 'Invalid query parameters' })
    }
    const { limit } = parseResult.data

    try {
      const revisions = await service.listRevisions(productId, limit)
      return reply.code(200).send({ revisions })
    } catch (err) {
      return handleServiceError(err, reply)
    }
  })
}

function handleServiceError(err: unknown, reply: FastifyReply) {
  if (err instanceof ValidationError) return reply.code(400).send({ error: err.message })
  if (err instanceof ConflictError) return reply.code(409).send({ error: err.message })
  if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message })
  throw err
}

export default adminPlugin
