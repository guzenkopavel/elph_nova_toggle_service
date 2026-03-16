import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import { createApp } from '../../../src/app'
import type { FastifyInstance } from 'fastify'
import { DefaultProductsRepository } from '../../../src/modules/products/repository'
import { DefaultDefinitionsRepository } from '../../../src/modules/definitions/repository'
import { DefaultRulesRepository } from '../../../src/modules/rules/repository'
import { ConfigResolutionService } from '../../../src/modules/config-resolution/service'
import type { TokenVerifier, AuthResult } from '../../../src/modules/auth/token-verifier'
import { TokenInvalidError, InfraError } from '../../../src/modules/auth/token-verifier'

// ─── Mock verifier factory ────────────────────────────────────────────────────

function makeMockVerifier(
  verifyFn?: (header: string | undefined) => Promise<AuthResult>
): TokenVerifier {
  return {
    verify: verifyFn ?? (async (header) => {
      if (!header) return { state: 'anonymous' }
      // Safe default for non-auth tests: treat any token as anonymous
      return { state: 'anonymous' }
    }),
  }
}

function createTestKnex(): Knex {
  return KnexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, '../../../src/db/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  })
}

const BASE_DEF = {
  default_entry_json: '{"isEnabled":true,"name":"Chat","description":"Real-time chat"}',
  payload_schema_json: null,
  manifest_owner: null,
  source_priority_mode: 'server',
  delivery_mode: 'remoteCapable',
  manifest_hash: 'testhash1',
  status: 'active' as const,
}

describe('GET /api/v1/feature-config', () => {
  let db: Knex
  let app: FastifyInstance
  let productId: number
  let resolutionService: ConfigResolutionService

  beforeAll(async () => {
    db = createTestKnex()
    await db.migrate.latest()

    const productsRepo = new DefaultProductsRepository(db)
    const definitionsRepo = new DefaultDefinitionsRepository(db)
    const rulesRepo = new DefaultRulesRepository(db)
    resolutionService = new ConfigResolutionService(productsRepo, definitionsRepo, rulesRepo)

    // Seed product and definitions once for the whole suite.
    // Individual tests that need a clean state manage it separately.
    const product = await productsRepo.upsertByName('test_product', 3600)
    productId = product.id

    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'chat',
      ...BASE_DEF,
    })
    await definitionsRepo.upsert({
      product_id: productId,
      feature_key: 'video_call',
      default_entry_json: '{"isEnabled":false,"name":"Video","description":"Video calls"}',
      payload_schema_json: null,
      manifest_owner: null,
      source_priority_mode: 'server',
      delivery_mode: 'remoteCapable',
      manifest_hash: 'testhash1',
      status: 'active',
    })

    app = await createApp({
      logger: false,
      publicOptions: {
        resolutionService,
        productId,
        tokenVerifier: makeMockVerifier(),
      },
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await db.destroy()
  })

  // Reset cache before each test so rule changes are reflected.
  beforeEach(() => {
    resolutionService.invalidateCache(productId)
  })

  // ─── A: Header validation (400) ──────────────────────────────────────────────

  it('A1: missing Platform header — platform inferred from User-Agent, returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        AppName: 'ElphNova',
        AppVersion: '2.0.0',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('A2: invalid Platform value returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'fax',
        AppName: 'ElphNova',
        AppVersion: '2.0.0',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('A3: missing AppName header — optional, returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'ios',
        AppVersion: '2.0.0',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it('A4: missing AppVersion header — defaults to 1.0.0, returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'ios',
        AppName: 'ElphNova',
      },
    })
    expect(res.statusCode).toBe(200)
  })

  // ─── B: Successful 200 responses ─────────────────────────────────────────────

  it('B1: valid headers with no auth returns 200 with features map', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'ios',
        AppName: 'ElphNova',
        AppVersion: '2.0.0',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ version: number; ttl: number; features: Record<string, unknown> }>()
    expect(typeof body.version).toBe('number')
    expect(typeof body.ttl).toBe('number')
    expect(body.ttl).toBe(3600)
    expect(typeof body.features).toBe('object')
  })

  it('B5: response includes Cache-Control: no-store header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'android',
        AppName: 'ElphNova',
        AppVersion: '1.5.0',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('B6: all seeded feature keys are present in response', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'web',
        AppName: 'ElphNova',
        AppVersion: '3.0.0',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ features: Record<string, unknown> }>()
    const keys = Object.keys(body.features)
    expect(keys.length).toBeGreaterThanOrEqual(1)
    expect(keys).toContain('chat')
    expect(keys).toContain('video_call')
  })

  it('B7: feature entry contains isEnabled field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'ios',
        AppName: 'ElphNova',
        AppVersion: '2.0.0',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ features: Record<string, { isEnabled: boolean }> }>()
    expect(typeof body.features['chat']?.isEnabled).toBe('boolean')
  })

  // ─── C: Authorization header boundary (Task 8) ───────────────────────────────

  it('C1: valid token returns 200 with authenticated features', async () => {
    // Create an app whose verifier returns authenticated for any Bearer token.
    const authApp = await createApp({
      logger: false,
      publicOptions: {
        resolutionService,
        productId,
        tokenVerifier: makeMockVerifier(async (header) => {
          if (header?.startsWith('Bearer ')) return { state: 'authenticated', sub: 'user-abc' }
          return { state: 'anonymous' }
        }),
      },
    })
    await authApp.ready()

    try {
      const res = await authApp.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: {
          Platform: 'ios',
          AppName: 'ElphNova',
          AppVersion: '2.0.0',
          Authorization: 'Bearer validtoken',
        },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json<{ version: number; ttl: number; features: Record<string, unknown> }>()
      expect(typeof body.features).toBe('object')
      expect(typeof body.version).toBe('number')
    } finally {
      await authApp.close()
    }
  })

  it('C2: no Authorization header returns 200 anonymous (explicit boundary check)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/feature-config',
      headers: {
        Platform: 'ios',
        AppName: 'ElphNova',
        AppVersion: '2.0.0',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ features: Record<string, unknown> }>()
    expect(typeof body.features).toBe('object')
  })

  it('C3: invalid token (verifier throws TokenInvalidError) returns 401', async () => {
    const invalidTokenApp = await createApp({
      logger: false,
      publicOptions: {
        resolutionService,
        productId,
        tokenVerifier: makeMockVerifier(async (_header) => {
          throw new TokenInvalidError('Token is expired or invalid')
        }),
      },
    })
    await invalidTokenApp.ready()

    try {
      const res = await invalidTokenApp.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: {
          Platform: 'ios',
          AppName: 'ElphNova',
          AppVersion: '2.0.0',
          Authorization: 'Bearer badtoken',
        },
      })
      expect(res.statusCode).toBe(401)
      const body = res.json<{ error: string }>()
      expect(body.error).toBe('Unauthorized')
    } finally {
      await invalidTokenApp.close()
    }
  })

  it('C4: JWKS infra failure (verifier throws InfraError) returns 503', async () => {
    const infraFailApp = await createApp({
      logger: false,
      publicOptions: {
        resolutionService,
        productId,
        tokenVerifier: makeMockVerifier(async (_header) => {
          throw new InfraError('JWKS fetch timed out')
        }),
      },
    })
    await infraFailApp.ready()

    try {
      const res = await infraFailApp.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: {
          Platform: 'ios',
          AppName: 'ElphNova',
          AppVersion: '2.0.0',
          Authorization: 'Bearer sometoken',
        },
      })
      expect(res.statusCode).toBe(503)
      const body = res.json<{ error: string }>()
      expect(body.error).toBe('Service temporarily unavailable')
    } finally {
      await infraFailApp.close()
    }
  })

  it('C5: verifier not configured for tokens (no JWKS URI) returns 503 via InfraError', async () => {
    // Mimics production startup with no SSO_JWKS_URI: the verifier will throw
    // InfraError when a token is presented.
    const { createTokenVerifier } = await import('../../../src/modules/auth/token-verifier')
    const unconfiguredVerifier = createTokenVerifier({})

    const unconfiguredApp = await createApp({
      logger: false,
      publicOptions: {
        resolutionService,
        productId,
        tokenVerifier: unconfiguredVerifier,
      },
    })
    await unconfiguredApp.ready()

    try {
      const res = await unconfiguredApp.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: {
          Platform: 'ios',
          AppName: 'ElphNova',
          AppVersion: '2.0.0',
          Authorization: 'Bearer sometoken',
        },
      })
      expect(res.statusCode).toBe(503)
    } finally {
      await unconfiguredApp.close()
    }
  })

  // ─── D: Internal error path ──────────────────────────────────────────────────

  it('D1: unknown productId causes 500', async () => {
    // Create a separate app wired to a non-existent productId.
    // The resolution service will throw "product not found" which Fastify maps to 500.
    const badProductId = 99999
    const badApp = await createApp({
      logger: false,
      publicOptions: {
        resolutionService,
        productId: badProductId,
        tokenVerifier: makeMockVerifier(),
      },
    })
    await badApp.ready()

    try {
      const res = await badApp.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: {
          Platform: 'ios',
          AppName: 'ElphNova',
          AppVersion: '2.0.0',
        },
      })
      expect(res.statusCode).toBe(500)
    } finally {
      await badApp.close()
    }
  })
})
