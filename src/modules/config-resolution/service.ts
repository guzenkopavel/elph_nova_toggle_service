import type { DefinitionRow, DefinitionsRepository } from '../definitions/repository'
import type { RuleRow, RulesRepository } from '../rules/repository'
import type { ProductRow, ProductsRepository } from '../products/repository'
import type { CompiledSnapshot, RequestContext, ResolvedEntry } from './types'
import { selectBestRule } from './specificity'

// ParsedSnapshot is built once per (productId, revision) and reused across requests.
// All JSON.parse work happens at build time so the request path is allocation-light.

type ParsedRuleRow = RuleRow & { parsedEntry: ResolvedEntry }

interface ParsedSnapshot {
  productId: number
  revision: number
  ttlSeconds: number
  parsedDefaults: Map<string, ResolvedEntry>
  parsedRules: ParsedRuleRow[]
}

export class ConfigResolutionService {
  // Stores Promises so concurrent callers share the same in-flight load rather than
  // each firing independent DB queries (cache-stampede prevention).
  private cache = new Map<string, Promise<ParsedSnapshot>>()

  constructor(
    private readonly productsRepo: ProductsRepository,
    private readonly definitionsRepo: DefinitionsRepository,
    private readonly rulesRepo: RulesRepository,
  ) {}

  private cacheKey(productId: number, revision: number): string {
    return `${productId}:${revision}`
  }

  // Returns the parsed snapshot for the product at its current revision.
  // Concurrent callers that arrive before the first load completes share the same Promise.
  async buildRawSnapshot(productId: number): Promise<ParsedSnapshot> {
    const product = await this.productsRepo.findById(productId)
    if (!product) {
      throw new Error(`ConfigResolutionService: product not found (id=${productId})`)
    }

    const key = this.cacheKey(productId, product.current_revision)
    const existing = this.cache.get(key)
    if (existing) return existing

    const promise = this._loadParsedSnapshot(product).catch(err => {
      // Remove the key so a failed load does not permanently poison the cache.
      this.cache.delete(key)
      throw err
    })
    this.cache.set(key, promise)
    return promise
  }

  // Loads definitions and rules from DB and parses all JSON once.
  private async _loadParsedSnapshot(product: ProductRow): Promise<ParsedSnapshot> {
    const [definitions, rules] = await Promise.all([
      this.definitionsRepo.listActive(product.id),
      this.rulesRepo.listAllActive(product.id),
    ])

    const parsedDefaults = new Map<string, ResolvedEntry>()
    for (const def of definitions) {
      // Object.freeze prevents accidental mutation of shared snapshot data across concurrent requests.
      parsedDefaults.set(def.feature_key, Object.freeze(parseEntryJson(def.default_entry_json, def.feature_key)))
    }

    const parsedRules = rules.map(rule => ({
      ...rule,
      parsedEntry: Object.freeze(parseEntryJson(rule.entry_json, rule.feature_key)),
    }))

    return {
      productId: product.id,
      revision: product.current_revision,
      ttlSeconds: product.ttl_seconds,
      parsedDefaults,
      parsedRules,
    }
  }

  // Resolve a full feature map for the given request context.
  // Returns a CompiledSnapshot with features resolved per the RequestContext.
  async resolveConfig(productId: number, ctx: RequestContext): Promise<CompiledSnapshot> {
    const parsed = await this.buildRawSnapshot(productId)

    const features: Record<string, ResolvedEntry> = {}

    for (const [featureKey, defaultEntry] of parsed.parsedDefaults) {
      const rulesForKey = parsed.parsedRules.filter(r => r.feature_key === featureKey)
      const bestRule = selectBestRule(rulesForKey, ctx) as ParsedRuleRow | null
      features[featureKey] = bestRule ? bestRule.parsedEntry : defaultEntry
    }

    return {
      productId: parsed.productId,
      revision: parsed.revision,
      ttl: parsed.ttlSeconds,
      features,
    }
  }

  /**
   * Removes all cached snapshots for the given product.
   * Must be called only after the write transaction has fully committed —
   * never inside the transaction or concurrently with it.
   */
  invalidateCache(productId: number): void {
    const toDelete = [...this.cache.keys()].filter(k => k.startsWith(`${productId}:`))
    for (const key of toDelete) this.cache.delete(key)
  }

  // Force rebuild: invalidate then build fresh.
  async rebuildSnapshot(productId: number): Promise<ParsedSnapshot> {
    this.invalidateCache(productId)
    return this.buildRawSnapshot(productId)
  }
}

function parseEntryJson(json: string, featureKey: string): ResolvedEntry {
  try {
    const parsed = JSON.parse(json) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(`entry_json for '${featureKey}' is not an object`)
    }
    return parsed as ResolvedEntry
  } catch (err) {
    throw new Error(`ConfigResolutionService: failed to parse entry_json for '${featureKey}': ${String(err)}`)
  }
}
