import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../../../src/app'
import { DefaultProductsRepository } from '../../../src/modules/products/repository'
import { DefaultDefinitionsRepository } from '../../../src/modules/definitions/repository'
import { DefaultRulesRepository } from '../../../src/modules/rules/repository'
import { DefaultRevisionsRepository } from '../../../src/modules/revisions/repository'
import { DefaultDependenciesRepository } from '../../../src/modules/dependencies/repository'
import { ConfigResolutionService } from '../../../src/modules/config-resolution/service'
import { ManifestRegistry } from '../../../src/modules/manifest/registry'
import { AdminRulesService } from '../../../src/modules/admin/service'
import type { TokenVerifier, AuthResult } from '../../../src/modules/auth/token-verifier'
import { TokenInvalidError } from '../../../src/modules/auth/token-verifier'

// ─── Token verifier factories ─────────────────────────────────────────────────

function anonVerifier(): TokenVerifier {
  return { verify: async () => ({ state: 'anonymous' }) }
}

function invalidTokenVerifier(): TokenVerifier {
  return {
    verify: async (header) => {
      if (header) throw new TokenInvalidError('invalid token')
      return { state: 'anonymous' }
    },
  }
}

function viewerVerifier(): TokenVerifier {
  return {
    verify: async (): Promise<AuthResult> => ({
      state: 'authenticated',
      sub: 'viewer-1',
      roles: ['feature-toggle-viewer'],
    }),
  }
}

function editorVerifier(): TokenVerifier {
  return {
    verify: async (): Promise<AuthResult> => ({
      state: 'authenticated',
      sub: 'editor-1',
      roles: ['feature-toggle-editor'],
    }),
  }
}

// ─── Test DB setup ────────────────────────────────────────────────────────────

function createTestKnex(): Knex {
  return KnexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(process.cwd(), 'src/db/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  })
}

const BASE_DEF = {
  default_entry_json: '{"isEnabled":false}',
  payload_schema_json: null,
  manifest_owner: null,
  source_priority_mode: 'server',
  delivery_mode: 'remoteCapable',
  manifest_hash: 'hash1',
  status: 'active' as const,
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

describe('Admin UI routes', () => {
  let db: Knex
  let productId: number
  let productsRepo: DefaultProductsRepository
  let definitionsRepo: DefaultDefinitionsRepository
  let rulesRepo: DefaultRulesRepository
  let revisionsRepo: DefaultRevisionsRepository
  let depsRepo: DefaultDependenciesRepository
  let resolutionService: ConfigResolutionService
  let registry: ManifestRegistry
  let adminService: AdminRulesService

  beforeAll(async () => {
    db = createTestKnex()
    await db.migrate.latest()

    productsRepo = new DefaultProductsRepository(db)
    definitionsRepo = new DefaultDefinitionsRepository(db)
    rulesRepo = new DefaultRulesRepository(db)
    revisionsRepo = new DefaultRevisionsRepository(db)
    depsRepo = new DefaultDependenciesRepository(db)
    resolutionService = new ConfigResolutionService(productsRepo, definitionsRepo, rulesRepo)

    const product = await productsRepo.upsertByName('test_product_ui', 3600)
    productId = product.id

    await definitionsRepo.upsert({ product_id: productId, feature_key: 'chat', ...BASE_DEF })
    await definitionsRepo.upsert({ product_id: productId, feature_key: 'video_call', ...BASE_DEF })

    registry = new ManifestRegistry()
    registry.load([
      {
        key: 'chat',
        name: 'Chat',
        deliveryMode: 'remoteCapable',
        sourcePriorityMode: 'serverWins',
        defaultEntry: { isEnabled: false },
      },
      {
        key: 'video_call',
        name: 'Video Call',
        deliveryMode: 'remoteCapable',
        sourcePriorityMode: 'serverWins',
        defaultEntry: { isEnabled: false },
      },
    ], 'hash1')

    adminService = new AdminRulesService(db, registry, rulesRepo, productsRepo, revisionsRepo, resolutionService, depsRepo)
  })

  afterAll(async () => {
    await db.destroy()
  })

  beforeEach(async () => {
    await db('config_revisions').delete()
    await db('feature_rules').delete()
    await db('products').where({ id: productId }).update({ current_revision: 0 })
    resolutionService.invalidateCache(productId)
  })

  // ─── Helper ───────────────────────────────────────────────────────────────

  async function buildApp(verifier: TokenVerifier): Promise<FastifyInstance> {
    const app = await createApp({
      logger: false,
      adminOptions: {
        service: adminService,
        verifier,
        productId,
        registry,
      },
    })
    await app.ready()
    return app
  }

  // Get a CSRF token + cookie from a GET request
  async function getCsrfToken(app: FastifyInstance, url: string, authHeader: string): Promise<{ token: string; cookieHeader: string }> {
    const res = await app.inject({
      method: 'GET',
      url,
      headers: { Authorization: authHeader },
    })
    // Extract CSRF token from HTML (hidden input)
    const tokenMatch = res.body.match(/name="_csrf"\s+value="([^"]+)"/)
    const token = tokenMatch?.[1] ?? ''
    // Extract the _csrf cookie set by the server
    const rawCookies = res.headers['set-cookie']
    const cookieHeader = Array.isArray(rawCookies) ? rawCookies.join('; ') : (rawCookies ?? '')
    const csrfCookieMatch = cookieHeader.match(/_csrf=([^;]+)/)
    const csrfCookieValue = csrfCookieMatch?.[1] ?? ''
    return { token, cookieHeader: `_csrf=${csrfCookieValue}` }
  }

  // ─── S: Service unit ──────────────────────────────────────────────────────

  it('UI-S1: service.getCurrentRevision returns current_revision for known product', async () => {
    const rev = await adminService.getCurrentRevision(productId)
    expect(typeof rev).toBe('number')
    expect(rev).toBe(0) // reset in beforeEach
  })

  it('UI-S2: service.getCurrentRevision throws NotFoundError for unknown product id', async () => {
    await expect(adminService.getCurrentRevision(999999)).rejects.toThrow('not found')
  })

  // ─── H: Auth boundary ─────────────────────────────────────────────────────

  it('UI-H1: GET /admin/features no auth → 401', async () => {
    const app = await buildApp(anonVerifier())
    try {
      const res = await app.inject({ method: 'GET', url: '/admin/features' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('UI-H2: GET /admin/features invalid token → 401', async () => {
    const app = await buildApp(invalidTokenVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/features',
        headers: { Authorization: 'Bearer bad' },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('UI-H3: GET /admin/features viewer token → 200 text/html', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/features',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
    } finally {
      await app.close()
    }
  })

  it('UI-H4: GET /admin/features/:key viewer token → 200, HTML contains key name', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/features/chat',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('chat')
    } finally {
      await app.close()
    }
  })

  it('UI-H5: POST /admin/features/:key/rules viewer token → 403', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      // Attempt to POST as viewer (editor required)
      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/rules',
        headers: {
          Authorization: 'Bearer viewer-token',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'audience=all&platform=all&entry_json=%7B%22isEnabled%22%3Atrue%7D&reason=test&expected_revision=0',
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('UI-H6: GET /admin/revisions viewer token → 200 text/html', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/revisions',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
    } finally {
      await app.close()
    }
  })

  it('UI-H7: GET /admin/preview viewer token → 200 text/html', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/preview',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
    } finally {
      await app.close()
    }
  })

  // ─── C: CSRF ─────────────────────────────────────────────────────────────

  it('UI-C1: POST create rule editor, no CSRF token → 403', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/rules',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'audience=all&platform=all&entry_json=%7B%22isEnabled%22%3Atrue%7D&reason=test&expected_revision=0',
      })
      // No CSRF cookie or token → 403
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('UI-C2: POST create rule editor, wrong CSRF token → 403', async () => {
    const app = await buildApp(editorVerifier())
    try {
      // First get a valid CSRF secret cookie by visiting the form
      const formRes = await app.inject({
        method: 'GET',
        url: '/admin/features/chat/rules/new',
        headers: { Authorization: 'Bearer editor-token' },
      })
      const rawCookies = formRes.headers['set-cookie']
      const cookieHeader = Array.isArray(rawCookies) ? rawCookies.join('; ') : (rawCookies ?? '')
      const csrfCookieMatch = cookieHeader.match(/_csrf=([^;]+)/)
      const csrfCookieValue = csrfCookieMatch?.[1] ?? ''

      // Submit with a wrong token but valid cookie
      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/rules',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: `_csrf=${csrfCookieValue}`,
        },
        body: 'audience=all&platform=all&entry_json=%7B%22isEnabled%22%3Atrue%7D&reason=test&expected_revision=0&_csrf=wrong-token',
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('UI-C3: POST create rule editor, valid CSRF + valid body → 302 redirect', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const { token, cookieHeader } = await getCsrfToken(app, '/admin/features/chat/rules/new', 'Bearer editor-token')
      expect(token).not.toBe('')

      const body = [
        `audience=all`,
        `platform=all`,
        `entry_json=${encodeURIComponent('{"isEnabled":true}')}`,
        `reason=test+create`,
        `expected_revision=0`,
        `_csrf=${encodeURIComponent(token)}`,
      ].join('&')

      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/rules',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
        },
        body,
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers['location']).toBe('/admin/features/chat')
    } finally {
      await app.close()
    }
  })

  it('UI-C4: POST quick-toggle, no CSRF → 403', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/quick-toggle',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'enabled=true&expected_revision=0',
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  // ─── V: Form validation ───────────────────────────────────────────────────

  it('UI-V1: POST create rule with missing reason → 200 with HTML error', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const { token, cookieHeader } = await getCsrfToken(app, '/admin/features/chat/rules/new', 'Bearer editor-token')

      const body = [
        `audience=all`,
        `platform=all`,
        `entry_json=${encodeURIComponent('{"isEnabled":true}')}`,
        `reason=`,
        `expected_revision=0`,
        `_csrf=${encodeURIComponent(token)}`,
      ].join('&')

      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/rules',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
        },
        body,
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('reason')
    } finally {
      await app.close()
    }
  })

  it('UI-V2: POST create rule with stale revision → 200 with conflict error in HTML', async () => {
    // Create a rule first to advance revision to 1
    await adminService.createRule({
      productId,
      feature_key: 'video_call',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'initial',
      expectedRevision: 0,
    })

    const app = await buildApp(editorVerifier())
    try {
      const { token, cookieHeader } = await getCsrfToken(app, '/admin/features/chat/rules/new', 'Bearer editor-token')

      // Try to create with stale revision 0 (current is 1)
      const body = [
        `audience=all`,
        `platform=all`,
        `entry_json=${encodeURIComponent('{"isEnabled":true}')}`,
        `reason=stale`,
        `expected_revision=0`,
        `_csrf=${encodeURIComponent(token)}`,
      ].join('&')

      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/rules',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
        },
        body,
      })
      expect(res.statusCode).toBe(200)
      expect(res.body.toLowerCase()).toMatch(/conflict|revision/)
    } finally {
      await app.close()
    }
  })

  it('UI-V3: POST create rule with invalid entry_json → 200 with error', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const { token, cookieHeader } = await getCsrfToken(app, '/admin/features/chat/rules/new', 'Bearer editor-token')

      const body = [
        `audience=all`,
        `platform=all`,
        `entry_json=not-valid-json`,
        `reason=test`,
        `expected_revision=0`,
        `_csrf=${encodeURIComponent(token)}`,
      ].join('&')

      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/rules',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
        },
        body,
      })
      expect(res.statusCode).toBe(200)
      expect(res.body.toLowerCase()).toMatch(/json|invalid/)
    } finally {
      await app.close()
    }
  })

  // ─── R: Rendering ─────────────────────────────────────────────────────────

  it('UI-R1: GET /admin/features shows feature key names in HTML', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/features',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('chat')
      expect(res.body).toContain('video_call')
    } finally {
      await app.close()
    }
  })

  it('UI-R2: GET /admin/features/:key with active rule shows rule in HTML', async () => {
    await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'authenticated',
      platform: 'ios',
      entry_json: { isEnabled: true },
      reason: 'enable chat ios auth',
      expectedRevision: 0,
    })

    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/features/chat',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('authenticated')
      expect(res.body).toContain('ios')
    } finally {
      await app.close()
    }
  })

  it('UI-R3: GET /admin/revisions after write shows revision entry', async () => {
    await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'revision test reason',
      expectedRevision: 0,
    })

    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/revisions',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('revision test reason')
    } finally {
      await app.close()
    }
  })

  it('UI-R4: GET /admin/preview?platform=ios&appVersion=1.0.0&audience=anonymous shows resolved features HTML (parity with JSON API)', async () => {
    // Create a rule enabling chat for authenticated on ios
    await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'authenticated',
      platform: 'ios',
      entry_json: { isEnabled: true },
      reason: 'parity test',
      expectedRevision: 0,
    })

    const app = await buildApp(viewerVerifier())
    try {
      // Preview UI for anonymous on ios — chat should still be false (default)
      const uiRes = await app.inject({
        method: 'GET',
        url: '/admin/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(uiRes.statusCode).toBe(200)
      expect(uiRes.headers['content-type']).toMatch(/text\/html/)
      expect(uiRes.body).toContain('chat')
      // Also check that the JSON API returns consistent data
      const jsonRes = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(jsonRes.statusCode).toBe(200)
      const jsonBody = jsonRes.json<{ features: { chat: { isEnabled: boolean } } }>()
      // HTML page should contain the same feature keys
      expect(uiRes.body).toContain('chat')
      expect(jsonBody.features.chat.isEnabled).toBe(false)
    } finally {
      await app.close()
    }
  })

  // ─── QT: Quick toggle ────────────────────────────────────────────────────

  it('UI-QT1: POST quick-toggle with valid CSRF and valid revision → 302 redirect', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const { token, cookieHeader } = await getCsrfToken(app, '/admin/features/chat', 'Bearer editor-token')
      expect(token).not.toBe('')

      const body = [
        `enabled=true`,
        `expected_revision=0`,
        `_csrf=${encodeURIComponent(token)}`,
      ].join('&')

      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/quick-toggle',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
        },
        body,
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers['location']).toBe('/admin/features/chat')
    } finally {
      await app.close()
    }
  })

  it('UI-QT2: POST quick-toggle with stale revision → 200 with conflict HTML', async () => {
    // Advance revision to 1 first
    await adminService.createRule({
      productId,
      feature_key: 'video_call',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'advance revision',
      expectedRevision: 0,
    })

    const app = await buildApp(editorVerifier())
    try {
      const { token, cookieHeader } = await getCsrfToken(app, '/admin/features/chat', 'Bearer editor-token')

      // Use stale revision 0, current is 1
      const body = [
        `enabled=true`,
        `expected_revision=0`,
        `_csrf=${encodeURIComponent(token)}`,
      ].join('&')

      const res = await app.inject({
        method: 'POST',
        url: '/admin/features/chat/quick-toggle',
        headers: {
          Authorization: 'Bearer editor-token',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieHeader,
        },
        body,
      })
      expect(res.statusCode).toBe(200)
      expect(res.body.toLowerCase()).toMatch(/conflict|revision/)
    } finally {
      await app.close()
    }
  })
})
