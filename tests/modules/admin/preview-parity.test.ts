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

// Public verifier: no header → anonymous; any header → anonymous for parity tests
function publicAnonVerifier(): TokenVerifier {
  return { verify: async () => ({ state: 'anonymous' }) }
}

// Admin viewer verifier: always authenticates as viewer
function viewerVerifier(): TokenVerifier {
  return {
    verify: async (): Promise<AuthResult> => ({
      state: 'authenticated',
      sub: 'viewer-1',
      roles: ['feature-toggle-viewer'],
    }),
  }
}

// Public verifier that recognises 'Bearer auth-token' as authenticated
function publicWithAuthVerifier(): TokenVerifier {
  return {
    verify: async (header): Promise<AuthResult> => {
      if (!header) return { state: 'anonymous' }
      const match = /^Bearer\s+(.+)$/i.exec(header)
      if (!match) throw new TokenInvalidError('Malformed Authorization header')
      const token = match[1]
      if (token === 'auth-token') return { state: 'authenticated', sub: 'user-1', roles: [] }
      throw new TokenInvalidError('Invalid token')
    },
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

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Preview/public parity (PAR)', () => {
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

    const product = await productsRepo.upsertByName('parity_product', 3600)
    productId = product.id

    await definitionsRepo.upsert({ product_id: productId, feature_key: 'feature_a', ...BASE_DEF })
    await definitionsRepo.upsert({ product_id: productId, feature_key: 'feature_b', ...BASE_DEF })

    registry = new ManifestRegistry()
    registry.load([
      {
        key: 'feature_a',
        name: 'Feature A',
        deliveryMode: 'remoteCapable',
        sourcePriorityMode: 'serverWins',
        defaultEntry: { isEnabled: false },
      },
      {
        key: 'feature_b',
        name: 'Feature B',
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

  function buildParityApp(options?: { publicVerifier?: TokenVerifier }): Promise<FastifyInstance> {
    const resolvedPublicVerifier = options?.publicVerifier ?? publicAnonVerifier()
    return createApp({
      logger: false,
      publicOptions: {
        resolutionService,
        productId,
        tokenVerifier: resolvedPublicVerifier,
      },
      adminOptions: {
        service: adminService,
        verifier: viewerVerifier(),
        productId,
      },
    })
  }

  it('PAR1: baseline parity — no rules, anonymous context', async () => {
    const app = await buildParityApp()
    try {
      const pubRes = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { platform: 'ios', appname: 'TestApp', appversion: '1.0.0' },
      })
      const preRes = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { authorization: 'Bearer viewer-token' },
      })

      expect(pubRes.statusCode).toBe(200)
      expect(preRes.statusCode).toBe(200)

      const pubBody = pubRes.json<{ version: number; ttl: number; features: Record<string, unknown> }>()
      const preBody = preRes.json<{ version: number; ttl: number; features: Record<string, unknown> }>()

      expect(preBody.version).toBe(pubBody.version)
      expect(preBody.ttl).toBe(pubBody.ttl)
      expect(preBody.features).toEqual(pubBody.features)
    } finally {
      await app.close()
    }
  })

  it('PAR2: parity with a rule — rule applies to anonymous ios', async () => {
    await adminService.createRule({
      productId,
      feature_key: 'feature_a',
      audience: 'anonymous',
      platform: 'ios',
      entry_json: { isEnabled: true },
      reason: 'enable feature_a anon ios',
      expectedRevision: 0,
    })

    const app = await buildParityApp()
    try {
      const pubRes = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { platform: 'ios', appname: 'TestApp', appversion: '1.0.0' },
      })
      const preRes = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { authorization: 'Bearer viewer-token' },
      })

      expect(pubRes.statusCode).toBe(200)
      expect(preRes.statusCode).toBe(200)

      const pubBody = pubRes.json<{ version: number; ttl: number; features: Record<string, { isEnabled: boolean }> }>()
      const preBody = preRes.json<{ version: number; ttl: number; features: Record<string, { isEnabled: boolean }> }>()

      expect(preBody.version).toBe(pubBody.version)
      expect(preBody.ttl).toBe(pubBody.ttl)
      expect(preBody.features).toEqual(pubBody.features)
      expect(preBody.features['feature_a'].isEnabled).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('PAR3: parity — authenticated audience context', async () => {
    await adminService.createRule({
      productId,
      feature_key: 'feature_b',
      audience: 'authenticated',
      platform: 'android',
      entry_json: { isEnabled: true },
      reason: 'enable feature_b auth android',
      expectedRevision: 0,
    })

    const app = await buildParityApp({ publicVerifier: publicWithAuthVerifier() })
    try {
      // Public: authenticated user on android
      const pubRes = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: {
          platform: 'android',
          appname: 'TestApp',
          appversion: '2.0.0',
          authorization: 'Bearer auth-token',
        },
      })
      const preRes = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=android&appVersion=2.0.0&audience=authenticated',
        headers: { authorization: 'Bearer viewer-token' },
      })

      expect(pubRes.statusCode).toBe(200)
      expect(preRes.statusCode).toBe(200)

      const pubBody = pubRes.json<{ version: number; ttl: number; features: Record<string, { isEnabled: boolean }> }>()
      const preBody = preRes.json<{ version: number; ttl: number; features: Record<string, { isEnabled: boolean }> }>()

      expect(preBody.version).toBe(pubBody.version)
      expect(preBody.ttl).toBe(pubBody.ttl)
      expect(preBody.features).toEqual(pubBody.features)
      expect(preBody.features['feature_b'].isEnabled).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('PAR4: parity — anonymous sees default when rule targets authenticated only', async () => {
    await adminService.createRule({
      productId,
      feature_key: 'feature_a',
      audience: 'authenticated',
      platform: 'all',
      entry_json: { isEnabled: true },
      reason: 'enable feature_a auth only',
      expectedRevision: 0,
    })

    const app = await buildParityApp()
    try {
      const pubRes = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { platform: 'ios', appname: 'TestApp', appversion: '1.0.0' },
        // no Authorization → anonymous
      })
      const preRes = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { authorization: 'Bearer viewer-token' },
      })

      expect(pubRes.statusCode).toBe(200)
      expect(preRes.statusCode).toBe(200)

      const pubBody = pubRes.json<{ version: number; ttl: number; features: Record<string, { isEnabled: boolean }> }>()
      const preBody = preRes.json<{ version: number; ttl: number; features: Record<string, { isEnabled: boolean }> }>()

      expect(preBody.version).toBe(pubBody.version)
      expect(preBody.ttl).toBe(pubBody.ttl)
      expect(preBody.features).toEqual(pubBody.features)
      expect(preBody.features['feature_a'].isEnabled).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('PAR5: parity — different platform returns different features', async () => {
    await adminService.createRule({
      productId,
      feature_key: 'feature_a',
      audience: 'anonymous',
      platform: 'ios',
      entry_json: { isEnabled: true },
      reason: 'ios only enable',
      expectedRevision: 0,
    })

    const app = await buildParityApp()
    try {
      // iOS public
      const pubIosRes = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { platform: 'ios', appname: 'TestApp', appversion: '1.0.0' },
      })
      const preIosRes = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { authorization: 'Bearer viewer-token' },
      })

      expect(pubIosRes.statusCode).toBe(200)
      expect(preIosRes.statusCode).toBe(200)
      const pubIos = pubIosRes.json<{ features: Record<string, { isEnabled: boolean }> }>()
      const preIos = preIosRes.json<{ features: Record<string, { isEnabled: boolean }> }>()
      expect(preIos.features).toEqual(pubIos.features)
      expect(preIos.features['feature_a'].isEnabled).toBe(true)

      // Android public — rule does not apply
      const pubAndRes = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { platform: 'android', appname: 'TestApp', appversion: '1.0.0' },
      })
      const preAndRes = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=android&appVersion=1.0.0&audience=anonymous',
        headers: { authorization: 'Bearer viewer-token' },
      })

      expect(pubAndRes.statusCode).toBe(200)
      expect(preAndRes.statusCode).toBe(200)
      const pubAnd = pubAndRes.json<{ features: Record<string, { isEnabled: boolean }> }>()
      const preAnd = preAndRes.json<{ features: Record<string, { isEnabled: boolean }> }>()
      expect(preAnd.features).toEqual(pubAnd.features)
      expect(preAnd.features['feature_a'].isEnabled).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('PAR6: parity — revision advances after write, both endpoints reflect same revision', async () => {
    const app = await buildParityApp()
    try {
      // Before write: check initial revision parity
      const pubBefore = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { platform: 'ios', appname: 'TestApp', appversion: '1.0.0' },
      })
      const preBefore = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { authorization: 'Bearer viewer-token' },
      })

      const pubBodyBefore = pubBefore.json<{ version: number }>()
      const preBodyBefore = preBefore.json<{ version: number }>()
      expect(preBodyBefore.version).toBe(pubBodyBefore.version)

      // Write a rule
      await adminService.createRule({
        productId,
        feature_key: 'feature_a',
        audience: 'all',
        platform: 'all',
        entry_json: { isEnabled: true },
        reason: 'revision advance test',
        expectedRevision: pubBodyBefore.version,
      })

      // After write: both should reflect the new revision
      const pubAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/feature-config',
        headers: { platform: 'ios', appname: 'TestApp', appversion: '1.0.0' },
      })
      const preAfter = await app.inject({
        method: 'GET',
        url: '/admin/api/preview?platform=ios&appVersion=1.0.0&audience=anonymous',
        headers: { authorization: 'Bearer viewer-token' },
      })

      const pubBodyAfter = pubAfter.json<{ version: number; features: Record<string, { isEnabled: boolean }> }>()
      const preBodyAfter = preAfter.json<{ version: number; features: Record<string, { isEnabled: boolean }> }>()
      expect(preBodyAfter.version).toBe(pubBodyAfter.version)
      expect(preBodyAfter.version).toBe(pubBodyBefore.version + 1)
      expect(preBodyAfter.features).toEqual(pubBodyAfter.features)
    } finally {
      await app.close()
    }
  })
})
