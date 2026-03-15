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
import { ConfigResolutionService } from '../../../src/modules/config-resolution/service'
import { ManifestRegistry } from '../../../src/modules/manifest/registry'
import { AdminRulesService } from '../../../src/modules/admin/service'
import type { TokenVerifier, AuthResult } from '../../../src/modules/auth/token-verifier'
import { TokenInvalidError, InfraError } from '../../../src/modules/auth/token-verifier'

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

function infraErrorVerifier(): TokenVerifier {
  return {
    verify: async (_header) => { throw new InfraError('jwks timeout') },
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

describe('Admin routes', () => {
  let db: Knex
  let productId: number
  let productsRepo: DefaultProductsRepository
  let definitionsRepo: DefaultDefinitionsRepository
  let rulesRepo: DefaultRulesRepository
  let revisionsRepo: DefaultRevisionsRepository
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
    resolutionService = new ConfigResolutionService(productsRepo, definitionsRepo, rulesRepo)

    const product = await productsRepo.upsertByName('test_product', 3600)
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

    adminService = new AdminRulesService(db, registry, rulesRepo, productsRepo, revisionsRepo, resolutionService)
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

  // ─── H: Auth boundary checks ──────────────────────────────────────────────

  it('H1: GET /admin/api/rules with no auth returns 401', async () => {
    const app = await buildApp(anonVerifier())
    try {
      const res = await app.inject({ method: 'GET', url: '/admin/api/rules' })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('H2: GET /admin/api/rules with invalid token returns 401', async () => {
    const app = await buildApp(invalidTokenVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer bad' },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it('H3: GET /admin/api/rules with infra error returns 503', async () => {
    const app = await buildApp(infraErrorVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer any' },
      })
      expect(res.statusCode).toBe(503)
    } finally {
      await app.close()
    }
  })

  it('H4: GET /admin/api/rules with viewer role returns 200', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('H5: POST /admin/api/rules with viewer role returns 403', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer viewer-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'test',
          expectedRevision: 0,
        }),
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('H6: POST /admin/api/rules with editor role returns 201', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'enable chat for all',
          expectedRevision: 0,
        }),
      })
      expect(res.statusCode).toBe(201)
      const body = res.json<{ rule: { id: number; feature_key: string } }>()
      expect(body.rule.feature_key).toBe('chat')
    } finally {
      await app.close()
    }
  })

  it('H7: PATCH /admin/api/rules/:id with viewer role returns 403', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/api/rules/1',
        headers: { Authorization: 'Bearer viewer-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'x', expectedRevision: 0 }),
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it('H8: DELETE /admin/api/rules/:id with viewer role returns 403', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/api/rules/1',
        headers: { Authorization: 'Bearer viewer-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'x', expectedRevision: 0 }),
      })
      expect(res.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  // ─── V: Validation checks ─────────────────────────────────────────────────

  it('V1: POST with unknown feature_key returns 400', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'nonexistent',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'test',
          expectedRevision: 0,
        }),
      })
      expect(res.statusCode).toBe(400)
      const body = res.json<{ error: string }>()
      expect(body.error).toMatch(/not in the manifest registry/)
    } finally {
      await app.close()
    }
  })

  it('V2: POST with empty reason returns 400', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: '',
          expectedRevision: 0,
        }),
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('V3: PATCH with empty reason returns 400', async () => {
    // First create a rule
    const rule = await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'initial',
      expectedRevision: 0,
    })

    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/api/rules/${rule.id}`,
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '', expectedRevision: 1 }),
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('V4: PATCH with stale revision returns 409', async () => {
    const rule = await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'initial',
      expectedRevision: 0,
    })

    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/api/rules/${rule.id}`,
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_json: { isEnabled: false },
          reason: 'update',
          expectedRevision: 0, // stale — current is 1 after create
        }),
      })
      expect(res.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })

  it('V5: DELETE with stale revision returns 409', async () => {
    const rule = await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'initial',
      expectedRevision: 0,
    })

    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/api/rules/${rule.id}`,
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'remove', expectedRevision: 0 }), // stale
      })
      expect(res.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })

  it('V6: PATCH on non-existent rule returns 404', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/api/rules/99999',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'update', expectedRevision: 0 }),
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('V7: DELETE on non-existent rule returns 404', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/admin/api/rules/99999',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'remove', expectedRevision: 0 }),
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('V8: GET /admin/api/rules/:id on non-existent rule returns 404', async () => {
    const app = await buildApp(viewerVerifier())
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/api/rules/99999',
        headers: { Authorization: 'Bearer viewer-token' },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('V9: POST with ambiguous overlap returns 409', async () => {
    // Create first rule for chat/all/all
    await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'initial rule',
      expectedRevision: 0,
    })

    const app = await buildApp(editorVerifier())
    try {
      // Try to create duplicate overlapping rule
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: false },
          reason: 'second rule',
          expectedRevision: 1,
        }),
      })
      expect(res.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })

  it('ZB1: POST with invalid audience value returns 400 from zod schema', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'superusers', // not in enum
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'test',
          expectedRevision: 0,
        }),
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('ZB2: POST with non-integer expectedRevision returns 400 from zod schema', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'test',
          expectedRevision: 1.5, // float, not integer
        }),
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('ZB3: POST with missing feature_key returns 400 from zod schema', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'test',
          expectedRevision: 0,
          // feature_key omitted
        }),
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('ZB4: PATCH with invalid platform value returns 400 from zod schema', async () => {
    const rule = await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'initial',
      expectedRevision: 0,
    })
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/api/rules/${rule.id}`,
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'playstation', // not in enum
          reason: 'update',
          expectedRevision: 1,
        }),
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('ZB5: DELETE with missing reason returns 400 from zod schema', async () => {
    const rule = await adminService.createRule({
      productId,
      feature_key: 'chat',
      audience: 'all',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'initial',
      expectedRevision: 0,
    })
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/admin/api/rules/${rule.id}`,
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1 }), // reason omitted
      })
      expect(res.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('S1: changedBy in revisions is JWT sub, not role label', async () => {
    const app = await buildApp(editorVerifier()) // editorVerifier returns sub: 'editor-1'
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'sub identity check',
          expectedRevision: 0,
        }),
      })
      expect(res.statusCode).toBe(201)

      // Inspect the revision record to confirm changed_by is the sub, not the role label
      const revisions = await db('config_revisions').where({ product_id: productId }).orderBy('revision', 'desc').limit(1)
      expect(revisions[0].changed_by).toBe('editor-1')
      expect(revisions[0].changed_by).not.toBe('feature-toggle-editor')
    } finally {
      await app.close()
    }
  })

  it('V10: POST with stale revision returns 409', async () => {
    const app = await buildApp(editorVerifier())
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'reason',
          expectedRevision: 999, // current is 0
        }),
      })
      expect(res.statusCode).toBe(409)
    } finally {
      await app.close()
    }
  })

  // ─── CI: Cache invalidation ───────────────────────────────────────────────

  it('CI1: cache is invalidated after a successful write', async () => {
    const app = await buildApp(editorVerifier())
    try {
      // First POST creates a rule
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'video_call',
          audience: 'all',
          platform: 'all',
          entry_json: { isEnabled: true },
          reason: 'enable video call',
          expectedRevision: 0,
        }),
      })
      expect(createRes.statusCode).toBe(201)

      // GET list should reflect the new rule
      const listRes = await app.inject({
        method: 'GET',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token' },
      })
      expect(listRes.statusCode).toBe(200)
      const body = listRes.json<{ rules: Array<{ feature_key: string }> }>()
      expect(body.rules.some((r) => r.feature_key === 'video_call')).toBe(true)
    } finally {
      await app.close()
    }
  })

  // ─── B: Basic CRUD round-trip ─────────────────────────────────────────────

  it('B1: full CRUD round-trip: create, get, update, disable', async () => {
    const app = await buildApp(editorVerifier())
    try {
      // Create
      const createRes = await app.inject({
        method: 'POST',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: 'chat',
          audience: 'authenticated',
          platform: 'ios',
          entry_json: { isEnabled: true },
          reason: 'enable chat on ios for auth users',
          expectedRevision: 0,
        }),
      })
      expect(createRes.statusCode).toBe(201)
      const { rule: createdRule } = createRes.json<{ rule: { id: number; audience: string; platform: string } }>()
      expect(createdRule.audience).toBe('authenticated')
      expect(createdRule.platform).toBe('ios')

      // Get
      const getRes = await app.inject({
        method: 'GET',
        url: `/admin/api/rules/${createdRule.id}`,
        headers: { Authorization: 'Bearer editor-token' },
      })
      expect(getRes.statusCode).toBe(200)

      // Update
      const updateRes = await app.inject({
        method: 'PATCH',
        url: `/admin/api/rules/${createdRule.id}`,
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: 'all',
          reason: 'expand to all users',
          expectedRevision: 1,
        }),
      })
      expect(updateRes.statusCode).toBe(200)
      const { rule: updatedRule } = updateRes.json<{ rule: { audience: string } }>()
      expect(updatedRule.audience).toBe('all')

      // Disable
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/admin/api/rules/${createdRule.id}`,
        headers: { Authorization: 'Bearer editor-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'no longer needed', expectedRevision: 2 }),
      })
      expect(deleteRes.statusCode).toBe(200)
      const deleteBody = deleteRes.json<{ ok: boolean }>()
      expect(deleteBody.ok).toBe(true)

      // After disable, rule should not appear in list
      const listRes = await app.inject({
        method: 'GET',
        url: '/admin/api/rules',
        headers: { Authorization: 'Bearer editor-token' },
      })
      const listBody = listRes.json<{ rules: Array<{ id: number }> }>()
      expect(listBody.rules.find((r) => r.id === createdRule.id)).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  // ─── Helpers ─────────────────────────────────────────────────────────────

  async function buildApp(verifier: TokenVerifier): Promise<FastifyInstance> {
    const app = await createApp({
      logger: false,
      adminOptions: {
        service: adminService,
        verifier,
        productId,
      },
    })
    await app.ready()
    return app
  }
})
