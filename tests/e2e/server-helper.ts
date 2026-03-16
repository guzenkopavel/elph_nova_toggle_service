import path from 'path'
import type { FastifyInstance } from 'fastify'
import KnexLib from 'knex'
import type { Knex } from 'knex'
import { createApp } from '../../src/app'
import { DefaultProductsRepository } from '../../src/modules/products/repository'
import { DefaultDefinitionsRepository } from '../../src/modules/definitions/repository'
import { DefaultRulesRepository } from '../../src/modules/rules/repository'
import { DefaultRevisionsRepository } from '../../src/modules/revisions/repository'
import { DefaultDependenciesRepository } from '../../src/modules/dependencies/repository'
import { ConfigResolutionService } from '../../src/modules/config-resolution/service'
import { ManifestRegistry } from '../../src/modules/manifest/registry'
import { AdminRulesService } from '../../src/modules/admin/service'
import type { TokenVerifier, AuthResult } from '../../src/modules/auth/token-verifier'

export const E2E_PORT = 3099
export const EDITOR_TOKEN = 'e2e-editor-token'
export const VIEWER_TOKEN = 'e2e-viewer-token'

function makeEditorVerifier(): TokenVerifier {
  return {
    verify: async (): Promise<AuthResult> => ({
      state: 'authenticated',
      sub: 'e2e-editor',
      roles: ['feature-toggle-editor'],
    }),
  }
}

export interface E2EServer {
  app: FastifyInstance
  db: Knex
  productId: number
  adminService: AdminRulesService
  registry: ManifestRegistry
  stop: () => Promise<void>
}

export async function startE2EServer(): Promise<E2EServer> {
  const db = KnexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(process.cwd(), 'src/db/migrations'),
      extension: 'ts',
      loadExtensions: ['.ts'],
    },
  })

  await db.migrate.latest()

  const productsRepo = new DefaultProductsRepository(db)
  const definitionsRepo = new DefaultDefinitionsRepository(db)
  const rulesRepo = new DefaultRulesRepository(db)
  const revisionsRepo = new DefaultRevisionsRepository(db)
  const depsRepo = new DefaultDependenciesRepository(db)
  const resolutionService = new ConfigResolutionService(productsRepo, definitionsRepo, rulesRepo, depsRepo)

  const product = await productsRepo.upsertByName('e2e_product', 3600)
  const productId = product.id

  await definitionsRepo.upsert({
    product_id: productId,
    feature_key: 'chat',
    default_entry_json: '{"isEnabled":false}',
    payload_schema_json: null,
    manifest_owner: null,
    source_priority_mode: 'server',
    delivery_mode: 'remoteCapable',
    manifest_hash: 'e2e-hash',
    status: 'active',
  })
  await definitionsRepo.upsert({
    product_id: productId,
    feature_key: 'video_call',
    default_entry_json: '{"isEnabled":false}',
    payload_schema_json: null,
    manifest_owner: null,
    source_priority_mode: 'server',
    delivery_mode: 'remoteCapable',
    manifest_hash: 'e2e-hash',
    status: 'active',
  })
  await definitionsRepo.upsert({
    product_id: productId,
    feature_key: 'premium',
    default_entry_json: '{"isEnabled":false}',
    payload_schema_json: null,
    manifest_owner: null,
    source_priority_mode: 'server',
    delivery_mode: 'remoteCapable',
    manifest_hash: 'e2e-hash',
    status: 'active',
  })

  const registry = new ManifestRegistry()
  registry.load([
    {
      key: 'chat',
      name: 'Chat Feature',
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
    {
      key: 'premium',
      name: 'Premium Features',
      deliveryMode: 'remoteCapable',
      sourcePriorityMode: 'serverWins',
      defaultEntry: { isEnabled: false },
    },
  ], 'e2e-hash')

  const adminService = new AdminRulesService(db, registry, rulesRepo, productsRepo, revisionsRepo, resolutionService, depsRepo)
  const verifier = makeEditorVerifier()

  const app = await createApp({
    logger: false,
    adminOptions: {
      service: adminService,
      verifier,
      productId,
      registry,
    },
  })

  await app.listen({ port: E2E_PORT, host: '127.0.0.1' })

  return {
    app,
    db,
    productId,
    adminService,
    registry,
    stop: async () => {
      await app.close()
      await db.destroy()
    },
  }
}
