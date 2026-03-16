import type { Knex } from 'knex'
import { withTransaction } from '../../db/transaction.js'
import type { ManifestRegistry } from '../manifest/registry.js'
import type { DefaultRulesRepository, RuleRow } from '../rules/repository.js'
import type { DefaultProductsRepository } from '../products/repository.js'
import type { DefaultRevisionsRepository, RevisionRow } from '../revisions/repository.js'
import type { ConfigResolutionService } from '../config-resolution/service.js'
import type { CompiledSnapshot, RequestContext } from '../config-resolution/types.js'
import { detectAmbiguousOverlap } from '../config-resolution/specificity.js'
import type { DependenciesRepository, DependencyRow } from '../dependencies/repository.js'
import { wouldCreateCycle } from '../dependencies/cycle.js'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export interface CreateRuleInput {
  productId: number
  feature_key: string
  audience: 'all' | 'anonymous' | 'authenticated'
  platform: 'all' | 'ios' | 'android' | 'web' | 'desktop'
  min_app_version?: string | null
  max_app_version?: string | null
  entry_json: Record<string, unknown>
  reason: string
  expectedRevision: number
  changedBy?: string
}

export interface UpdateRuleInput {
  productId: number
  ruleId: number
  audience?: 'all' | 'anonymous' | 'authenticated'
  platform?: 'all' | 'ios' | 'android' | 'web' | 'desktop'
  min_app_version?: string | null
  max_app_version?: string | null
  entry_json?: Record<string, unknown>
  reason: string
  expectedRevision: number
  changedBy?: string
}

export interface DisableRuleInput {
  productId: number
  ruleId: number
  reason: string
  expectedRevision: number
  changedBy?: string
}

export interface AddDependencyInput {
  productId: number
  parentKey: string
  childKey: string
  reason?: string
  expectedRevision: number
  changedBy?: string
}

export interface RemoveDependencyInput {
  productId: number
  depId: number
  reason?: string
  expectedRevision: number
  changedBy?: string
}

export class AdminRulesService {
  constructor(
    private readonly db: Knex,
    private readonly registry: ManifestRegistry,
    private readonly rulesRepo: DefaultRulesRepository,
    private readonly productsRepo: DefaultProductsRepository,
    private readonly revisionsRepo: DefaultRevisionsRepository,
    private readonly resolutionService: ConfigResolutionService,
    private readonly depsRepo: DependenciesRepository,
  ) {}

  async createRule(input: CreateRuleInput): Promise<RuleRow> {
    if (!this.registry.hasKey(input.feature_key)) {
      throw new ValidationError(`Feature key '${input.feature_key}' is not in the manifest registry`)
    }

    if (!input.reason || !input.reason.trim()) {
      throw new ValidationError('reason is required and must be non-empty')
    }

    this.validateEntryJson(input.feature_key, input.entry_json)

    await this.checkAmbiguousOverlap(input.productId, input.feature_key, {
      audience: input.audience,
      platform: input.platform,
      min_app_version: input.min_app_version ?? null,
      max_app_version: input.max_app_version ?? null,
    })

    // Read product outside the transaction to avoid SQLite deadlock (single connection).
    // The actual revision conflict is detected atomically inside updateRevision.
    const product = await this.productsRepo.findById(input.productId)
    if (!product) throw new NotFoundError(`Product ${input.productId} not found`)

    let createdRule!: RuleRow
    await withTransaction(this.db, async (trx) => {
      createdRule = await this.rulesRepo.create({
        product_id: input.productId,
        feature_key: input.feature_key,
        audience: input.audience,
        platform: input.platform,
        min_app_version: input.min_app_version ?? null,
        max_app_version: input.max_app_version ?? null,
        entry_json: JSON.stringify(input.entry_json),
        is_active: true,
        created_by: input.changedBy ?? null,
        updated_by: null,
      }, trx)

      const newRevision = product.current_revision + 1
      try {
        await this.productsRepo.updateRevision(input.productId, newRevision, input.expectedRevision, trx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('Revision conflict')) {
          console.error('[AdminRulesService] unexpected updateRevision error:', err)
        }
        throw new ConflictError(`Revision conflict: expected ${input.expectedRevision}`)
      }

      await this.revisionsRepo.insert({
        product_id: input.productId,
        revision: newRevision,
        change_type: 'rule_created',
        feature_key: input.feature_key,
        rule_id: createdRule.id,
        old_value_json: null,
        new_value_json: JSON.stringify(input.entry_json),
        reason: input.reason,
        changed_by: input.changedBy ?? 'unknown',
        request_id: null,
      }, trx)
    })

    // invalidateCache must run synchronously after the transaction commits — no await between here and the transaction.
    this.resolutionService.invalidateCache(input.productId)
    return createdRule
  }

  async updateRule(input: UpdateRuleInput): Promise<RuleRow> {
    if (!input.reason || !input.reason.trim()) {
      throw new ValidationError('reason is required and must be non-empty')
    }

    const existing = await this.rulesRepo.findById(input.ruleId)
    if (!existing || !existing.is_active) {
      throw new NotFoundError(`Rule ${input.ruleId} not found or inactive`)
    }

    if (existing.product_id !== input.productId) {
      throw new NotFoundError(`Rule ${input.ruleId} does not belong to product ${input.productId}`)
    }

    if (input.entry_json !== undefined) {
      this.validateEntryJson(existing.feature_key, input.entry_json)
    }

    const newAudience = input.audience ?? existing.audience
    const newPlatform = input.platform ?? existing.platform
    const newMinVersion = input.min_app_version !== undefined ? input.min_app_version : existing.min_app_version
    const newMaxVersion = input.max_app_version !== undefined ? input.max_app_version : existing.max_app_version

    await this.checkAmbiguousOverlap(input.productId, existing.feature_key, {
      audience: newAudience,
      platform: newPlatform,
      min_app_version: newMinVersion,
      max_app_version: newMaxVersion,
    }, input.ruleId)

    const productForUpdate = await this.productsRepo.findById(input.productId)
    if (!productForUpdate) throw new NotFoundError(`Product ${input.productId} not found`)

    let updatedRule!: RuleRow
    await withTransaction(this.db, async (trx) => {
      const fields: Record<string, unknown> = { updated_by: input.changedBy ?? null }
      if (input.audience !== undefined) fields['audience'] = input.audience
      if (input.platform !== undefined) fields['platform'] = input.platform
      if (input.min_app_version !== undefined) fields['min_app_version'] = input.min_app_version
      if (input.max_app_version !== undefined) fields['max_app_version'] = input.max_app_version
      if (input.entry_json !== undefined) fields['entry_json'] = JSON.stringify(input.entry_json)

      updatedRule = await this.rulesRepo.update(input.ruleId, fields, trx)

      const newRevision = productForUpdate.current_revision + 1
      try {
        await this.productsRepo.updateRevision(input.productId, newRevision, input.expectedRevision, trx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('Revision conflict')) {
          console.error('[AdminRulesService] unexpected updateRevision error:', err)
        }
        throw new ConflictError(`Revision conflict: expected ${input.expectedRevision}`)
      }

      await this.revisionsRepo.insert({
        product_id: input.productId,
        revision: newRevision,
        change_type: 'rule_updated',
        feature_key: existing.feature_key,
        rule_id: input.ruleId,
        old_value_json: existing.entry_json,
        new_value_json: input.entry_json ? JSON.stringify(input.entry_json) : existing.entry_json,
        reason: input.reason,
        changed_by: input.changedBy ?? 'unknown',
        request_id: null,
      }, trx)
    })

    // invalidateCache must run synchronously after the transaction commits — no await between here and the transaction.
    this.resolutionService.invalidateCache(input.productId)
    return updatedRule
  }

  async disableRule(input: DisableRuleInput): Promise<void> {
    if (!input.reason || !input.reason.trim()) {
      throw new ValidationError('reason is required and must be non-empty')
    }

    const existing = await this.rulesRepo.findById(input.ruleId)
    if (!existing || !existing.is_active) {
      throw new NotFoundError(`Rule ${input.ruleId} not found or already inactive`)
    }

    if (existing.product_id !== input.productId) {
      throw new NotFoundError(`Rule ${input.ruleId} does not belong to product ${input.productId}`)
    }

    const productForDisable = await this.productsRepo.findById(input.productId)
    if (!productForDisable) throw new NotFoundError(`Product ${input.productId} not found`)

    await withTransaction(this.db, async (trx) => {
      await this.rulesRepo.disable(input.ruleId, input.changedBy ?? 'unknown', trx)

      const newRevision = productForDisable.current_revision + 1
      try {
        await this.productsRepo.updateRevision(input.productId, newRevision, input.expectedRevision, trx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('Revision conflict')) {
          console.error('[AdminRulesService] unexpected updateRevision error:', err)
        }
        throw new ConflictError(`Revision conflict: expected ${input.expectedRevision}`)
      }

      await this.revisionsRepo.insert({
        product_id: input.productId,
        revision: newRevision,
        change_type: 'rule_disabled',
        feature_key: existing.feature_key,
        rule_id: input.ruleId,
        old_value_json: existing.entry_json,
        new_value_json: JSON.stringify({ is_active: false }),
        reason: input.reason,
        changed_by: input.changedBy ?? 'unknown',
        request_id: null,
      }, trx)
    })

    // invalidateCache must run synchronously after the transaction commits — no await between here and the transaction.
    this.resolutionService.invalidateCache(input.productId)
  }

  async listRules(productId: number): Promise<RuleRow[]> {
    return this.rulesRepo.listAllActive(productId)
  }

  async getRule(ruleId: number, productId: number): Promise<RuleRow> {
    const rule = await this.rulesRepo.findById(ruleId)
    if (!rule) throw new NotFoundError(`Rule ${ruleId} not found`)
    if (rule.product_id !== productId) throw new NotFoundError(`Rule ${ruleId} not found`)
    return rule
  }

  async previewConfig(productId: number, ctx: RequestContext): Promise<CompiledSnapshot> {
    return await this.resolutionService.resolveConfig(productId, ctx)
  }

  async getCurrentRevision(productId: number): Promise<number> {
    const product = await this.productsRepo.findById(productId)
    if (!product) throw new NotFoundError(`Product ${productId} not found`)
    return product.current_revision
  }

  async listRevisions(productId: number, limit: number): Promise<RevisionRow[]> {
    return await this.revisionsRepo.listByProduct(productId, limit)
  }

  async addDependency(input: AddDependencyInput): Promise<DependencyRow> {
    if (!this.registry.hasKey(input.parentKey)) {
      throw new ValidationError(`Feature key '${input.parentKey}' is not in the manifest registry`)
    }
    if (!this.registry.hasKey(input.childKey)) {
      throw new ValidationError(`Feature key '${input.childKey}' is not in the manifest registry`)
    }
    if (input.parentKey === input.childKey) {
      throw new ValidationError('A feature cannot depend on itself')
    }

    // Double-check against DB to guard against registry/DB divergence (e.g. mid-sync restart)
    const [parentDef, childDef] = await Promise.all([
      this.db('feature_definitions')
        .where({ product_id: input.productId, feature_key: input.parentKey, status: 'active' })
        .first(),
      this.db('feature_definitions')
        .where({ product_id: input.productId, feature_key: input.childKey, status: 'active' })
        .first(),
    ])
    if (!parentDef) throw new ValidationError(`Feature key '${input.parentKey}' not active in feature_definitions`)
    if (!childDef) throw new ValidationError(`Feature key '${input.childKey}' not active in feature_definitions`)

    const existing = await this.depsRepo.findEdge(input.productId, input.parentKey, input.childKey)
    if (existing) {
      throw new ValidationError('Dependency already exists')
    }

    // Note: cycle and duplicate checks are non-transactional reads followed by a transactional write.
    // Under SQLite writes serialize so TOCTOU is not possible. Under PostgreSQL the unique constraint
    // on (product_id, parent_key, child_key) prevents duplicate edges. Cycle TOCTOU has a tiny
    // window; the resolution-time safety-net (Kahn's algo with cycle logging) prevents silent corruption.
    const allEdges = await this.depsRepo.listByProduct(input.productId)
    if (wouldCreateCycle(allEdges, input.parentKey, input.childKey)) {
      throw new ValidationError('Adding this dependency would create a cycle')
    }

    // Read product outside the transaction to avoid SQLite deadlock (single connection).
    const product = await this.productsRepo.findById(input.productId)
    if (!product) throw new NotFoundError(`Product ${input.productId} not found`)

    let createdDep!: DependencyRow
    await withTransaction(this.db, async (trx) => {
      createdDep = await this.depsRepo.add({
        product_id: input.productId,
        parent_feature_key: input.parentKey,
        child_feature_key: input.childKey,
        reason: input.reason ?? null,
      }, trx)

      const newRevision = product.current_revision + 1
      try {
        await this.productsRepo.updateRevision(input.productId, newRevision, input.expectedRevision, trx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('Revision conflict')) {
          console.error('[AdminRulesService] unexpected updateRevision error:', err)
        }
        throw new ConflictError(`Revision conflict: expected ${input.expectedRevision}`)
      }

      await this.revisionsRepo.insert({
        product_id: input.productId,
        revision: newRevision,
        change_type: 'dependency_added',
        feature_key: input.parentKey,
        rule_id: null,
        old_value_json: null,
        new_value_json: JSON.stringify({ parent: input.parentKey, child: input.childKey }),
        reason: input.reason ?? '',
        changed_by: input.changedBy ?? 'unknown',
        request_id: null,
      }, trx)
    })

    // invalidateCache must run synchronously after the transaction commits.
    this.resolutionService.invalidateCache(input.productId)
    return createdDep
  }

  async removeDependency(input: RemoveDependencyInput): Promise<void> {
    const dep = await this.depsRepo.findById(input.depId)
    if (!dep || dep.product_id !== input.productId) {
      throw new NotFoundError(`Dependency ${input.depId} not found`)
    }

    // Read product outside the transaction to avoid SQLite deadlock (single connection).
    const product = await this.productsRepo.findById(input.productId)
    if (!product) throw new NotFoundError(`Product ${input.productId} not found`)

    await withTransaction(this.db, async (trx) => {
      await this.depsRepo.remove(input.depId, trx)

      const newRevision = product.current_revision + 1
      try {
        await this.productsRepo.updateRevision(input.productId, newRevision, input.expectedRevision, trx)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('Revision conflict')) {
          console.error('[AdminRulesService] unexpected updateRevision error:', err)
        }
        throw new ConflictError(`Revision conflict: expected ${input.expectedRevision}`)
      }

      const edgeJson = JSON.stringify({ parent: dep.parent_feature_key, child: dep.child_feature_key })
      await this.revisionsRepo.insert({
        product_id: input.productId,
        revision: newRevision,
        change_type: 'dependency_removed',
        feature_key: dep.parent_feature_key,
        rule_id: null,
        old_value_json: edgeJson,
        new_value_json: edgeJson,
        reason: input.reason ?? '',
        changed_by: input.changedBy ?? 'unknown',
        request_id: null,
      }, trx)
    })

    // invalidateCache must run synchronously after the transaction commits.
    this.resolutionService.invalidateCache(input.productId)
  }

  async listDependencies(productId: number): Promise<DependencyRow[]> {
    return this.depsRepo.listByProduct(productId)
  }

  private validateEntryJson(featureKey: string, entryJson: Record<string, unknown>): void {
    const def = this.registry.getByKey(featureKey)
    if (!def) throw new ValidationError(`Feature key '${featureKey}' not in registry`)

    if (!def.payload_schema_json) return

    let schema: { fields?: Array<{ name: string }> }
    try {
      schema = JSON.parse(def.payload_schema_json) as { fields?: Array<{ name: string }> }
    } catch {
      // Unparseable schema — skip validation rather than blocking all writes
      return
    }

    const schemaFields = schema.fields ?? []
    const schemaKeys = new Set(schemaFields.map((f) => f.name))

    if (schemaKeys.size === 0) return

    for (const key of Object.keys(entryJson)) {
      if (key !== 'isEnabled' && !schemaKeys.has(key)) {
        throw new ValidationError(`Unknown field '${key}' in entry_json for feature '${featureKey}'`)
      }
    }
  }

  private async checkAmbiguousOverlap(
    productId: number,
    featureKey: string,
    candidate: {
      audience: string
      platform: string
      min_app_version: string | null | undefined
      max_app_version: string | null | undefined
    },
    excludeRuleId?: number,
  ): Promise<void> {
    const existing = await this.rulesRepo.listAllActive(productId)
    const filtered = existing.filter(
      (r) => r.feature_key === featureKey && (excludeRuleId === undefined || r.id !== excludeRuleId),
    )

    const candidateRule: RuleRow = {
      id: -1,
      product_id: productId,
      feature_key: featureKey,
      audience: candidate.audience as RuleRow['audience'],
      platform: candidate.platform as RuleRow['platform'],
      min_app_version: candidate.min_app_version ?? null,
      max_app_version: candidate.max_app_version ?? null,
      entry_json: '{}',
      is_active: true,
      created_by: null,
      updated_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const overlaps = detectAmbiguousOverlap([...filtered, candidateRule])
    if (overlaps.length > 0) {
      throw new ConflictError(`Ambiguous rule overlap detected for feature '${featureKey}'`)
    }
  }
}
