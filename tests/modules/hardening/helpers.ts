import KnexLib from 'knex'
import type { Knex } from 'knex'
import path from 'path'
import type { FastifyInstance } from 'fastify'
import { createApp, type AppOptions } from '../../../src/app'
import { DefaultProductsRepository } from '../../../src/modules/products/repository'
import { DefaultDefinitionsRepository } from '../../../src/modules/definitions/repository'
import { DefaultRulesRepository } from '../../../src/modules/rules/repository'
import { DefaultRevisionsRepository } from '../../../src/modules/revisions/repository'
import { DefaultDependenciesRepository } from '../../../src/modules/dependencies/repository'
import { ConfigResolutionService } from '../../../src/modules/config-resolution/service'
import { ManifestRegistry } from '../../../src/modules/manifest/registry'
import { AdminRulesService } from '../../../src/modules/admin/service'
import type { TokenVerifier, AuthResult } from '../../../src/modules/auth/token-verifier'

export function createTestKnex(): Knex {
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

export function viewerVerifier(): TokenVerifier {
  return {
    verify: async (): Promise<AuthResult> => ({
      state: 'authenticated',
      sub: 'viewer-1',
      roles: ['feature-toggle-viewer'],
    }),
  }
}

export function editorVerifier(): TokenVerifier {
  return {
    verify: async (): Promise<AuthResult> => ({
      state: 'authenticated',
      sub: 'editor-1',
      roles: ['feature-toggle-editor'],
    }),
  }
}

export function anonVerifier(): TokenVerifier {
  return {
    verify: async (): Promise<AuthResult> => ({ state: 'anonymous' }),
  }
}

export interface HardeningTestContext {
  app: FastifyInstance
  db: Knex
  productId: number
  adminService: AdminRulesService
  resolutionService: ConfigResolutionService
  close: () => Promise<void>
}

const BASE_DEF = {
  default_entry_json: '{"isEnabled":false}',
  payload_schema_json: null,
  manifest_owner: null,
  source_priority_mode: 'server',
  delivery_mode: 'remoteCapable',
  manifest_hash: 'hash-hardening',
  status: 'active' as const,
}

export async function buildHardeningApp(
  overrides: Partial<AppOptions> = {},
): Promise<HardeningTestContext> {
  const db = createTestKnex()
  await db.migrate.latest()

  const productsRepo = new DefaultProductsRepository(db)
  const definitionsRepo = new DefaultDefinitionsRepository(db)
  const rulesRepo = new DefaultRulesRepository(db)
  const revisionsRepo = new DefaultRevisionsRepository(db)
  const depsRepo = new DefaultDependenciesRepository(db)
  const resolutionService = new ConfigResolutionService(productsRepo, definitionsRepo, rulesRepo)

  const product = await productsRepo.upsertByName('test_hardening', 3600)
  const productId = product.id

  await definitionsRepo.upsert({ product_id: productId, feature_key: 'chat', ...BASE_DEF })
  await definitionsRepo.upsert({ product_id: productId, feature_key: 'video_call', ...BASE_DEF })

  const registry = new ManifestRegistry()
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
  ], 'hash-hardening')

  const adminService = new AdminRulesService(
    db,
    registry,
    rulesRepo,
    productsRepo,
    revisionsRepo,
    resolutionService,
    depsRepo,
  )

  const defaultOptions: AppOptions = {
    logger: false,
    publicOptions: {
      resolutionService,
      productId,
      tokenVerifier: anonVerifier(),
    },
    adminOptions: {
      service: adminService,
      verifier: viewerVerifier(),
      productId,
    },
  }

  const app = await createApp({ ...defaultOptions, ...overrides })
  await app.ready()

  return {
    app,
    db,
    productId,
    adminService,
    resolutionService,
    close: async () => {
      await app.close()
      await db.destroy()
    },
  }
}
