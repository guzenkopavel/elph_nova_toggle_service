import { z } from 'zod'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, FastifyInstance } from 'fastify'
import type { AdminRulesService } from './service.js'
import type { TokenVerifier } from '../auth/token-verifier.js'
import { makeAdminAuthHook, ROLE_VIEWER, ROLE_EDITOR } from './auth.js'
import { ValidationError, ConflictError, NotFoundError } from './service.js'
import type { ManifestRegistry } from '../manifest/registry.js'
import type { RequestContext } from '../config-resolution/types.js'

// ─── Options ─────────────────────────────────────────────────────────────────

export interface AdminUiPluginOptions {
  service: AdminRulesService
  verifier: TokenVerifier
  productId: number
  registry: ManifestRegistry
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const adminUiPlugin: FastifyPluginAsync<AdminUiPluginOptions> = async (fastify, options) => {
  // WARNING 3: assert that csrfProtection was registered before this plugin
  if (typeof (fastify as FastifyInstance & { csrfProtection?: unknown }).csrfProtection !== 'function') {
    throw new Error('adminUiPlugin requires @fastify/csrf-protection to be registered before this plugin')
  }

  const { service, verifier, productId, registry } = options

  // ─── Auth hooks that return HTML errors ────────────────────────────────────

  function makeHtmlAuthHook(role: typeof ROLE_VIEWER | typeof ROLE_EDITOR) {
    const baseHook = makeAdminAuthHook(verifier, role)
    return async function htmlAuthHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
      const originalSend = reply.send.bind(reply) as FastifyReply['send']
      let intercepted = false
      ;(reply.send as FastifyReply['send']) = function (payload: unknown) {
        if (typeof payload === 'object' && payload !== null && 'error' in (payload as object)) {
          intercepted = true
          const statusCode = reply.statusCode || 401
          reply.send = originalSend
          return reply.type('text/html').code(statusCode).send(
            `<!DOCTYPE html><html><body><h1>Error ${statusCode}</h1><p>${(payload as { error: string }).error}</p><a href="/admin/features">Back</a></body></html>`
          )
        }
        return originalSend(payload)
      }
      await baseHook(request, reply)
      if (!intercepted) {
        reply.send = originalSend
      }
    }
  }

  const viewerHtmlHook = makeHtmlAuthHook(ROLE_VIEWER)
  const editorHtmlHook = makeHtmlAuthHook(ROLE_EDITOR)

  // ─── GET /admin → redirect ──────────────────────────────────────────────────

  fastify.get('/admin', {
    preHandler: makeAdminAuthHook(verifier, ROLE_VIEWER),
  }, async (_request, reply) => {
    return reply.redirect('/admin/features')
  })

  // ─── GET /admin/features ────────────────────────────────────────────────────

  fastify.get('/admin/features', {
    preHandler: viewerHtmlHook,
  }, async (_request, reply) => {
    const allDefs = registry.getAll()
    const allRules = await service.listRules(productId)

    const ruleCountByKey = new Map<string, number>()
    for (const rule of allRules) {
      ruleCountByKey.set(rule.feature_key, (ruleCountByKey.get(rule.feature_key) ?? 0) + 1)
    }

    const features = allDefs.map((def) => ({
      ...def,
      activeRuleCount: ruleCountByKey.get(def.feature_key) ?? 0,
    }))

    const html = await reply.viewAsync('features.njk', { features })
    return reply.send(html)
  })

  // ─── GET /admin/features/:key ───────────────────────────────────────────────

  fastify.get<{ Params: { key: string } }>('/admin/features/:key', {
    preHandler: viewerHtmlHook,
  }, async (request, reply) => {
    const { key } = request.params
    const definition = registry.getByKey(key)
    if (!definition) {
      return reply.type('text/html').code(404).send(
        `<!DOCTYPE html><html><body><h1>404</h1><p>Feature key '${escapeHtml(key)}' not found in manifest.</p><a href="/admin/features">Back</a></body></html>`
      )
    }

    const allRules = await service.listRules(productId)
    const rules = allRules.filter((r) => r.feature_key === key)
    const currentRevision = await service.getCurrentRevision(productId)
    const csrfToken = reply.generateCsrf()

    const html = await reply.viewAsync('feature.njk', {
      featureKey: key,
      definition,
      rules,
      currentRevision,
      csrfToken,
    })
    return reply.send(html)
  })

  // ─── GET /admin/features/:key/rules/new ────────────────────────────────────

  fastify.get<{ Params: { key: string } }>('/admin/features/:key/rules/new', {
    preHandler: viewerHtmlHook,
  }, async (request, reply) => {
    const { key } = request.params
    const definition = registry.getByKey(key)
    if (!definition) {
      return reply.type('text/html').code(404).send(
        `<!DOCTYPE html><html><body><h1>404</h1><p>Feature key '${escapeHtml(key)}' not found.</p><a href="/admin/features">Back</a></body></html>`
      )
    }

    const currentRevision = await service.getCurrentRevision(productId)
    const csrfToken = reply.generateCsrf()

    const html = await reply.viewAsync('rule-form.njk', {
      featureKey: key,
      editMode: false,
      formAction: `/admin/features/${key}/rules`,
      currentRevision,
      csrfToken,
      rule: null,
      errorMessage: null,
    })
    return reply.send(html)
  })

  // ─── GET /admin/features/:key/rules/:id/edit ───────────────────────────────

  fastify.get<{ Params: { key: string; id: string } }>('/admin/features/:key/rules/:id/edit', {
    preHandler: viewerHtmlHook,
  }, async (request, reply) => {
    const { key, id } = request.params
    const ruleId = parseInt(id, 10)
    if (isNaN(ruleId)) {
      return reply.type('text/html').code(400).send(
        `<!DOCTYPE html><html><body><h1>400</h1><p>Invalid rule id.</p></body></html>`
      )
    }

    let rule
    try {
      rule = await service.getRule(ruleId)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return reply.type('text/html').code(404).send(
          `<!DOCTYPE html><html><body><h1>404</h1><p>${escapeHtml(err.message)}</p></body></html>`
        )
      }
      throw err
    }

    const currentRevision = await service.getCurrentRevision(productId)
    const csrfToken = reply.generateCsrf()

    const html = await reply.viewAsync('rule-form.njk', {
      featureKey: key,
      editMode: true,
      formAction: `/admin/features/${key}/rules/${ruleId}`,
      currentRevision,
      csrfToken,
      rule,
      errorMessage: null,
    })
    return reply.send(html)
  })

  // ─── GET /admin/preview ─────────────────────────────────────────────────────

  fastify.get('/admin/preview', {
    preHandler: viewerHtmlHook,
  }, async (request, reply) => {
    const parseResult = previewQuerySchema.safeParse(request.query)
    if (!parseResult.success) {
      const html = await reply.viewAsync('preview.njk', { error: parseResult.error.errors[0]?.message })
      return reply.send(html)
    }

    const { platform, appVersion, audience } = parseResult.data

    let features: Record<string, unknown> | undefined
    let revision: number | undefined
    let error: string | undefined

    if (platform && appVersion) {
      const ctx: RequestContext = {
        authState: audience,
        platform,
        appVersion,
      }
      try {
        const snapshot = await service.previewConfig(productId, ctx)
        features = snapshot.features as Record<string, unknown>
        revision = snapshot.revision
      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error'
      }
    }

    const html = await reply.viewAsync('preview.njk', {
      platform,
      appVersion,
      audience,
      features,
      revision,
      error,
    })
    return reply.send(html)
  })

  // ─── GET /admin/preview/partial ─────────────────────────────────────────────

  fastify.get('/admin/preview/partial', {
    preHandler: viewerHtmlHook,
  }, async (request, reply) => {
    const parseResult = previewQuerySchema.safeParse(request.query)
    if (!parseResult.success) {
      return reply.type('text/html').send(
        `<p class="error">${parseResult.error.errors[0]?.message ?? 'Invalid parameters'}</p>`
      )
    }

    const { platform, appVersion, audience } = parseResult.data

    if (!platform || !appVersion) {
      return reply.type('text/html').send('<p>Select platform and app version above.</p>')
    }

    const ctx: RequestContext = {
      authState: audience,
      platform,
      appVersion,
    }

    try {
      const snapshot = await service.previewConfig(productId, ctx)
      const features = snapshot.features as Record<string, unknown>
      const revision = snapshot.revision

      const html = await reply.viewAsync('preview-partial.njk', { features, revision })
      return reply.send(html)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return reply.type('text/html').send(`<p class="error">${escapeHtml(message)}</p>`)
    }
  })

  // ─── GET /admin/revisions ───────────────────────────────────────────────────

  fastify.get('/admin/revisions', {
    preHandler: viewerHtmlHook,
  }, async (_request, reply) => {
    const revisions = await service.listRevisions(productId, 50)
    const html = await reply.viewAsync('revisions.njk', { revisions })
    return reply.send(html)
  })

  // ─── POST /admin/features/:key/rules (create) ──────────────────────────────

  fastify.post<{ Params: { key: string }; Body: Record<string, string> }>('/admin/features/:key/rules', {
    preHandler: [editorHtmlHook, fastify.csrfProtection],
  }, async (request, reply) => {
    const { key } = request.params
    const body = request.body ?? {}

    const result = parseRuleFormBody(body)
    if (!result.success) {
      return renderFormWithError(reply, service, productId, key, null, result.error, body)
    }

    const { audience, platform, min_app_version, max_app_version, entry_json, reason, expected_revision } = result.data

    try {
      await service.createRule({
        productId,
        feature_key: key,
        audience,
        platform,
        min_app_version: min_app_version || null,
        max_app_version: max_app_version || null,
        entry_json,
        reason,
        expectedRevision: expected_revision,
        changedBy: request.adminSub ?? 'unknown',
      })
    } catch (err) {
      const message = err instanceof ValidationError || err instanceof ConflictError
        ? err.message
        : 'Unexpected error'
      return renderFormWithError(reply, service, productId, key, null, message, body)
    }

    return reply.redirect(`/admin/features/${key}`)
  })

  // ─── POST /admin/features/:key/rules/:id (update) ──────────────────────────

  fastify.post<{ Params: { key: string; id: string }; Body: Record<string, string> }>('/admin/features/:key/rules/:id', {
    preHandler: [editorHtmlHook, fastify.csrfProtection],
  }, async (request, reply) => {
    const { key, id } = request.params
    const ruleId = parseInt(id, 10)
    if (isNaN(ruleId)) {
      return reply.type('text/html').code(400).send(
        `<!DOCTYPE html><html><body><h1>400</h1><p>Invalid rule id.</p></body></html>`
      )
    }

    const body = request.body ?? {}
    const result = parseRuleFormBody(body)
    if (!result.success) {
      return renderFormWithError(reply, service, productId, key, ruleId, result.error, body)
    }

    const { audience, platform, min_app_version, max_app_version, entry_json, reason, expected_revision } = result.data

    try {
      await service.updateRule({
        productId,
        ruleId,
        audience,
        platform,
        min_app_version: min_app_version || null,
        max_app_version: max_app_version || null,
        entry_json,
        reason,
        expectedRevision: expected_revision,
        changedBy: request.adminSub ?? 'unknown',
      })
    } catch (err) {
      const message = err instanceof ValidationError || err instanceof ConflictError
        ? err.message
        : 'Unexpected error'
      return renderFormWithError(reply, service, productId, key, ruleId, message, body)
    }

    return reply.redirect(`/admin/features/${key}`)
  })

  // ─── POST /admin/features/:key/rules/:id/disable ───────────────────────────

  fastify.post<{ Params: { key: string; id: string }; Body: Record<string, string> }>('/admin/features/:key/rules/:id/disable', {
    preHandler: [editorHtmlHook, fastify.csrfProtection],
  }, async (request, reply) => {
    const { key, id } = request.params
    const ruleId = parseInt(id, 10)
    if (isNaN(ruleId)) {
      return reply.type('text/html').code(400).send(
        `<!DOCTYPE html><html><body><h1>400</h1><p>Invalid rule id.</p></body></html>`
      )
    }

    const body = request.body ?? {}
    const expectedRevision = parseInt(body['expected_revision'] ?? '0', 10)
    const reason = body['reason'] || 'disabled via UI'

    try {
      await service.disableRule({
        productId,
        ruleId,
        reason,
        expectedRevision,
        changedBy: request.adminSub ?? 'unknown',
      })
    } catch (err) {
      if (err instanceof ConflictError || err instanceof ValidationError || err instanceof NotFoundError) {
        const currentRevision = await service.getCurrentRevision(productId)
        const allRules = await service.listRules(productId)
        const rules = allRules.filter((r) => r.feature_key === key)
        const csrfToken = reply.generateCsrf()
        const definition = registry.getByKey(key)
        const html = await reply.viewAsync('feature.njk', {
          featureKey: key,
          definition,
          rules,
          currentRevision,
          csrfToken,
          errorMessage: err.message,
        })
        return reply.code(200).send(html)
      }
      throw err
    }

    return reply.redirect(`/admin/features/${key}`)
  })

  // ─── POST /admin/features/:key/quick-toggle ────────────────────────────────

  fastify.post<{ Params: { key: string }; Body: Record<string, string> }>('/admin/features/:key/quick-toggle', {
    preHandler: [editorHtmlHook, fastify.csrfProtection],
  }, async (request, reply) => {
    const { key } = request.params
    const body = request.body ?? {}
    const enabledStr = body['enabled']
    const enabled = enabledStr === 'true'
    const expectedRevision = parseInt(body['expected_revision'] ?? '0', 10)

    const renderError = async (message: string) => {
      const currentRevision = await service.getCurrentRevision(productId)
      const allRules = await service.listRules(productId)
      const rules = allRules.filter((r) => r.feature_key === key)
      const csrfToken = reply.generateCsrf()
      const definition = registry.getByKey(key)
      const html = await reply.viewAsync('feature.njk', {
        featureKey: key,
        definition,
        rules,
        currentRevision,
        csrfToken,
        errorMessage: message,
      })
      return reply.code(200).send(html)
    }

    if (enabled) {
      try {
        await service.createRule({
          productId,
          feature_key: key,
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'quick-toggle enable',
          expectedRevision,
          changedBy: request.adminSub ?? 'unknown',
        })
      } catch (err) {
        if (err instanceof ConflictError || err instanceof ValidationError) {
          return await renderError(err.message)
        }
        throw err
      }
    } else {
      const allRules = await service.listRules(productId)
      const targetRule = allRules
        .filter((r) => r.feature_key === key && r.audience === 'all' && r.platform === 'all')
        .sort((a, b) => b.id - a.id)[0]

      if (!targetRule) {
        return await renderError('No active all/all rule found to disable.')
      }

      try {
        await service.disableRule({
          productId,
          ruleId: targetRule.id,
          reason: 'quick-toggle disable',
          expectedRevision,
          changedBy: request.adminSub ?? 'unknown',
        })
      } catch (err) {
        if (err instanceof ConflictError || err instanceof ValidationError) {
          return await renderError(err.message)
        }
        throw err
      }
    }

    return reply.redirect(`/admin/features/${key}`)
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const previewQuerySchema = z.object({
  platform: z.enum(['ios', 'android', 'web', 'desktop']).optional(),
  appVersion: z.string().min(1).optional(),
  audience: z.enum(['anonymous', 'authenticated']).default('anonymous'),
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

async function renderFormWithError(
  reply: FastifyReply,
  service: AdminRulesService,
  productId: number,
  featureKey: string,
  ruleId: number | null,
  errorMessage: string,
  body: Record<string, string>,
) {
  const currentRevision = await service.getCurrentRevision(productId)
  const csrfToken = reply.generateCsrf()

  const ruleData = ruleId !== null ? { ...body, id: ruleId } : null
  const editMode = ruleId !== null
  const formAction = editMode
    ? `/admin/features/${featureKey}/rules/${ruleId}`
    : `/admin/features/${featureKey}/rules`

  const html = await reply.viewAsync('rule-form.njk', {
    featureKey,
    editMode,
    formAction,
    currentRevision,
    csrfToken,
    rule: ruleData,
    errorMessage,
  })
  return reply.code(200).send(html)
}

// ─── Form body parsing ────────────────────────────────────────────────────────

interface ParsedRuleForm {
  audience: 'all' | 'anonymous' | 'authenticated'
  platform: 'all' | 'ios' | 'android' | 'web' | 'desktop'
  min_app_version: string | undefined
  max_app_version: string | undefined
  entry_json: Record<string, unknown>
  reason: string
  expected_revision: number
}

function parseRuleFormBody(body: Record<string, string>): { success: true; data: ParsedRuleForm } | { success: false; error: string } {
  const audienceSchema = z.enum(['all', 'anonymous', 'authenticated'])
  const platformSchema = z.enum(['all', 'ios', 'android', 'web', 'desktop'])

  const audienceResult = audienceSchema.safeParse(body['audience'])
  if (!audienceResult.success) return { success: false, error: 'Invalid audience value' }

  const platformResult = platformSchema.safeParse(body['platform'])
  if (!platformResult.success) return { success: false, error: 'Invalid platform value' }

  if (!body['reason'] || !body['reason'].trim()) {
    return { success: false, error: 'reason is required and must be non-empty' }
  }

  const entryJsonStr = body['entry_json']
  if (!entryJsonStr || !entryJsonStr.trim()) {
    return { success: false, error: 'entry_json is required' }
  }

  let entryJson: Record<string, unknown>
  try {
    const parsed = JSON.parse(entryJsonStr) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { success: false, error: 'entry_json must be a JSON object' }
    }
    entryJson = parsed as Record<string, unknown>
  } catch {
    return { success: false, error: 'entry_json is not valid JSON' }
  }

  const expectedRevision = parseInt(body['expected_revision'] ?? '0', 10)
  if (isNaN(expectedRevision)) {
    return { success: false, error: 'expected_revision must be a number' }
  }

  return {
    success: true,
    data: {
      audience: audienceResult.data,
      platform: platformResult.data,
      min_app_version: body['min_app_version'] || undefined,
      max_app_version: body['max_app_version'] || undefined,
      entry_json: entryJson,
      reason: body['reason'],
      expected_revision: expectedRevision,
    },
  }
}

export default adminUiPlugin
